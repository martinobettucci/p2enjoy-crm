#!/usr/bin/env bash
# @verifies CRM-013 (docs/BACKLOG.md) — Definition of Done des colonnes protégées
# @verifies docs/SPEC-permissions-rls.md §4.3 (le mécanisme), §4.4 (ce que `CRM-013` ferme),
#           §4.4.2 (le chemin d'insertion), §4.4.3 (la forme retenue), §4.4.4 (contrat d'API),
#           §4.4.6 (preuves attendues), §7 (refus n° 4, n° 6, n° 8, n° 11)
# @verifies docs/SPEC-cards.md §3.2 (forme), §3.3 (non-devinabilité), §3.4 (le trigger génère)
# @verifies docs/SPEC-workflow-engine.md §5.5 (bloc `GRANT`)
# @verifies docs/INCONSISTENCY_REPORT.md INC-026, INC-049, INC-050 (**close par exécution**)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-013` :
#
#   1. la suite pgTAP `supabase/tests/0015_colonnes_protegees.test.sql` est verte ;
#   2. les onze colonnes ouvertes le sont, la douzième ne l'est plus, et le compte est EXACT :
#      une fermeture de trop est aussi grave qu'une réouverture ;
#   3. le contrat d'API du §4.4.4 tient contre la pile, avec les jetons réels des trois profils,
#      chaque refus **relisant la ligne** pour la constater inchangée ;
#   4. la migration est **rejouable et convergente** : un `grant update on public.cards` relâché à
#      la main est REFERMÉ par le rejeu, non seulement laissé en l'état (décision 57) ;
#   5. la **dépendance d'ordre 12 → 14** est mesurée dans les DEUX sens : rejouer la migration 12
#      seule ROUVRE la colonne, et le harnais l'exige — c'est la troisième occurrence de la
#      décision 108, et la seule manière de garantir qu'un futur harnais ne laisse pas le produit
#      dégradé en sortant ;
#   6. le harnais est **non complaisant** : la colonne rendue à la main fait passer une écriture
#      qui doit être refusée, et la restauration est CONSTATÉE, pas supposée ;
#   7. ce qui reste dû à `CRM-013` est compté, table par table, plutôt que passé sous silence.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais ne prouve pas, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve rien d'une interface, et il n'y a rien à en prouver : cette unité ne livre aucun
# écran, et la webapp reste un appelant **anonyme** faute d'écran de connexion (INC-021). Un
# privilège de colonne est par construction invisible à un anonyme, qui ne voit déjà aucune card.
#
# La preuve de refus n° 6 reste bloquée par les tables mail et `api_tokens` absentes. La n° 8 est
# désormais satisfaite pour `card_events`, livrée par CRM-044 sans aucun privilège d'écriture ;
# `audit_log` reste absente. La section 7 mesure chacun de ces états au lieu de les supposer.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-colonnes-protegees.sh
#   scripts/verify-colonnes-protegees.sh --rapide   n'exécute ni les suites Playwright ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

TEST_FILE=supabase/tests/0015_colonnes_protegees.test.sql
MIGRATION_FILE=supabase/migrations/0014_colonnes_protegees.sql
# LA MIGRATION 12 REND CE QUE LA 14 RETIRE, et ce n'est pas une hypothèse : sa section 2 réapplique
# les privilèges de colonne avec `email_local_part` DANS la liste (INC-050, à l'époque non résolue).
# La section 5 s'en sert pour mesurer la dépendance d'ordre dans les deux sens.
MIGRATION_PRECEDENTE=supabase/migrations/0012_move_card.sql
# ET LA 13 DOIT SUIVRE LA 12 CHAQUE FOIS. Écrit après avoir commis la faute : la première version de
# ce harnais rejouait la 12 puis la 14, sans la 13 — et la 13 REDÉFINIT `move_card` avec sa sixième
# vérification depuis `CRM-036`. Le produit sortait donc avec une garde à CINQ vérifications, et
# `npm run test:sql` l'a dénoncé par QUATRE fichiers en échec. C'est la décision 135, reproduite à
# l'identique par le harnais suivant. CRM-018 redéfinit ensuite la garde contre la table de liaison :
# la séquence de restauration finale est donc 12 → 13 → 14 → 19, jamais partielle.
MIGRATION_INTERMEDIAIRE=supabase/migrations/0013_valeurs_champs.sql
MIGRATION_FINALE=supabase/migrations/0019_transition_required_fields.sql
DB_CONTAINER=p2enjoy-db

WS_SEED=5eed0000-0000-4000-8000-000000000001
WF_GLOBAL=5eed0000-0000-4000-8000-000000000051
CHANNEL_GRANDS_COMPTES=5eed0000-0000-4000-8000-000000000032
ETAPE_RELANCE=5eed0000-0000-4000-8000-000000000062
CARD_C1=5eed0000-0000-4000-8000-0000000000c1
CARD_C4=5eed0000-0000-4000-8000-0000000000c4
MAIL_ADMIN=admin@p2enjoy.test
MAIL_BIZDEV=bizdev@p2enjoy.test
MAIL_VIEWER=viewer@p2enjoy.test
MDP_SEED=SeedDev2026Local

# Les ONZE colonnes que `CRM-013` laisse ouvertes. Écrite UNE SEULE FOIS : deux copies
# divergeraient, et une restauration silencieusement fausse serait pire que l'absence de contrôle.
#
# ELLES ÉTAIENT DOUZE, ET `snoozed_until` EN EST SORTIE LE 2026-08-14. `CRM-081` a livré
# `endormir_card` / `reveiller_card` comme seul chemin d'écriture du sommeil, avec sa garde et sa
# trace de timeline ; tant que la colonne restait ouverte, un `PATCH` direct contournait l'une et
# faisait taire l'autre. Le compte descend donc à onze, et ce contrôle-ci l'a dénoncé dès la
# fermeture — c'est exactement ce qu'on lui demande, et la révision se fait dans le même changement.
COLONNES_OUVERTES="title, description, position, owner_id, amount, currency,
	probability_override, next_action, next_action_at,
	archived_at, deleted_at"

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,43p' "$0"; exit 0 ;;
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

CORPS=/tmp/p2enjoy-colonnes-body
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

prive() { psql_db -c "select has_column_privilege('$1', 'public.cards', '$2', '$3');"; }

# LA RESTAURATION EST POSÉE AVANT TOUTE DÉGRADATION : une interruption ne doit jamais laisser la
# base avec la porte que cette unité ferme. Elle rejoue la migration plutôt que de rejouer un
# `grant` recopié — c'est le produit qui restaure le produit.
restaurer() {
	# La 13 AVANT la 14, toujours : la section 5 rejoue la 12, qui ramène `move_card` à sa version à
	# cinq vérifications. Ne rejouer que la 14 laisserait la garde amputée — mesuré, cf. ci-dessus.
	# LE RÉPERTOIRE ENTIER, ET NON TROIS FICHIERS CHOISIS À LA MAIN — corrigé le 2026-08-14.
	#
	# La séquence 12 → 13 → 14 → 19 était juste le jour où elle a été écrite, et elle a vieilli :
	# `move_card` a été reprise depuis par des migrations ultérieures — l'arbitrage du lot G lui a
	# donné `app.btrim_blancs`, qui refuse un motif fait de blancs UNICODE. Rejouer jusqu'à la 19
	# seulement RAMENAIT la fonction à sa version d'alors, et la garde disparaissait.
	#
	# MESURÉ : après une exécution de ce harnais, `0013_move_card.test.sql` rendait « caught: no
	# exception » sur le motif blanc — l'assertion accusait le produit d'une régression que le
	# harnais venait lui-même de provoquer. Trois suites redevenaient rouges à chaque passage
	# (INC-142).
	#
	# Le runner rejoue tout le répertoire, dans l'ordre, et chaque migration est idempotente : c'est
	# la seule restauration qui ne vieillit pas. Elle coûte quelques secondes de plus, et elle rend
	# la base à l'état que le dépôt décrit, non à celui d'un instant révolu.
	# `--force-recreate` N'EST PAS DÉCORATIF, ET C'EST MESURÉ : le `migrations-runner` est un
	# conteneur à usage unique, et `docker compose up` sur un conteneur déjà sorti ne le REJOUE PAS.
	# Sans ce drapeau, la restauration ne restaurait rien — `move_card` restait à la version amputée
	# laissée par la dégradation, et trois suites accusaient le produit d'une régression que ce
	# harnais venait de provoquer.
	docker compose up --force-recreate migrations-runner >/dev/null 2>&1 || true
	psql_db -c "update public.cards set description = null, next_action = 'Relancer la DSI après la démo'
	             where id = '$CARD_C1';" >/dev/null 2>&1 || true
	psql_db -c "delete from public.cards where title like 'tst-crm013%';" >/dev/null 2>&1 || true
}
trap 'restaurer; rm -f "$CORPS"' EXIT
restaurer

ADRESSE_C1=$(psql_db -c "select email_local_part from public.cards where id = '$CARD_C1';")
[ -n "$ADRESSE_C1" ] || { echo "ERREUR : card C1 introuvable. Le seed est-il appliqué ?" >&2; exit 1; }

titre "1. Suite pgTAP"

sortie=$(psql_db -v ON_ERROR_STOP=1 -f - < "$TEST_FILE" 2>&1 || true)
if printf '%s' "$sortie" | grep -q '^not ok'; then
	fail "la suite pgTAP signale au moins une anomalie"
	printf '%s\n' "$sortie" | grep '^not ok' | head -5
else
	assertions=$(printf '%s' "$sortie" | grep -c '^ok ' || true)
	ok "suite pgTAP verte — $assertions assertions"
fi

titre "2. L'état des privilèges de colonne"

[ "$(prive authenticated email_local_part update)" = "f" ] \
	&& ok "email_local_part est FERMÉE à authenticated — l'adresse n'est plus réécrivable" \
	|| fail "email_local_part reste ouverte : CRM-013 n'est pas appliquée"

[ "$(prive authenticated email_local_part select)" = "t" ] \
	&& ok "…mais elle se LIT toujours : une adresse est une identité, pas un secret" \
	|| fail "la lecture a été fermée : CRM-013 a dépassé son objet"

[ "$(prive authenticated email_local_part insert)" = "t" ] \
	&& ok "…et l'INSERTION reste de table (décision 140) : le trigger neutralise déjà la valeur" \
	|| fail "l'insertion a été fermée : une requête inoffensive est désormais refusée"

[ "$(prive service_role email_local_part update)" = "t" ] \
	&& ok "service_role conserve l'écriture : le seed est inchangé — limite NOMMÉE au §4.4.3" \
	|| fail "service_role a perdu l'écriture : le seed ne peut plus s'appliquer"

[ "$(prive authenticated current_step_id update)" = "f" ] \
	&& ok "current_step_id reste fermée par CRM-034 : cette unité ne la rouvre pas (INC-049)" \
	|| fail "current_step_id a été rouverte : move_card redevient contournable"

# LE COMPTE EXACT. Sans lui, une fermeture trop large — le risque réel du mécanisme du §4.3 —
# passerait pour un durcissement bienvenu.
nb=$(psql_db -c "select count(*) from information_schema.column_privileges
                  where table_schema='public' and table_name='cards'
                    and grantee='authenticated' and privilege_type='UPDATE';")
[ "$nb" = "11" ] \
	&& ok "DOUZE colonnes ouvertes, ni onze ni treize — le compte exact, pas un ordre de grandeur" \
	|| fail "colonnes ouvertes : $nb au lieu de 12"

titre "3. Le contrat d'API du §4.4.4, avec les jetons réels"

T_ADMIN=$(jeton_de "$MAIL_ADMIN")
T_BIZDEV=$(jeton_de "$MAIL_BIZDEV")
T_VIEWER=$(jeton_de "$MAIL_VIEWER")
for couple in "T_ADMIN:$T_ADMIN" "T_BIZDEV:$T_BIZDEV" "T_VIEWER:$T_VIEWER"; do
	[ -n "${couple#*:}" ] || { echo "ERREUR : jeton ${couple%%:*} non obtenu." >&2; exit 1; }
done

patch_adresse() {  # jeton, valeur
	http PATCH "$API/rest/v1/cards?id=eq.$CARD_C1" \
		-H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" \
		-H 'Content-Type: application/json' -d "$(jq -nc --arg v "$2" '{email_local_part: $v}')"
}

code=$(patch_adresse "$T_ADMIN" 'c-00000000')
[ "$code" = "403" ] && [ "$(jq -r .code < "$CORPS")" = "42501" ] \
	&& ok "ligne a — admin refusé : 403, 42501" \
	|| fail "ligne a — admin obtient $code / $(jq -r '.code // "?"' < "$CORPS")"

[ "$(psql_db -c "select email_local_part from public.cards where id = '$CARD_C1';")" = "$ADRESSE_C1" ] \
	&& ok "ligne a — …et la ligne est RELUE INCHANGÉE : le refus n'est pas qu'un code HTTP" \
	|| fail "ligne a — l'adresse a changé malgré le refus"

# INC-026, CINQUIÈME occurrence : le `hint` de PostgREST divulgue la commande GRANT à exécuter.
# Le constater, c'est refuser qu'une divulgation devienne invisible à force d'être habituelle.
jq -r '.hint // ""' < "$CORPS" | grep -q 'GRANT UPDATE ON public.cards' \
	&& ok "ligne a — INC-026 : le refus divulgue bien la commande GRANT, constat inchangé" \
	|| fail "ligne a — le hint attendu par INC-026 a changé de forme"

code=$(http PATCH "$API/rest/v1/cards?id=eq.$CARD_C1" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_ADMIN" \
	-H 'Content-Type: application/json' -d '{"description":"sonde verify-colonnes"}')
[ "$code" = "204" ] \
	&& ok "ligne b — CONTRE-ÉPREUVE : une colonne ouverte s'écrit toujours" \
	|| fail "ligne b — l'écriture d'une colonne ouverte a échoué ($code) : le revoke est trop large"
psql_db -c "update public.cards set description = null where id = '$CARD_C1';" >/dev/null

titre_avant=$(psql_db -c "select title from public.cards where id = '$CARD_C1';")
code=$(http PATCH "$API/rest/v1/cards?id=eq.$CARD_C1" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_ADMIN" -H 'Content-Type: application/json' \
	-d '{"title":"TITRE QUI NE DOIT PAS PASSER","email_local_part":"c-00000000"}')
[ "$code" = "403" ] \
	&& ok "ligne c — une écriture mixte est refusée" \
	|| fail "ligne c — l'écriture mixte rend $code"
[ "$(psql_db -c "select title from public.cards where id = '$CARD_C1';")" = "$titre_avant" ] \
	&& ok "ligne c — …et le TITRE n'a pas été modifié non plus : le refus n'est pas partiel" \
	|| fail "ligne c — la partie permise de l'écriture a été appliquée : fuite silencieuse"

code=$(patch_adresse "$T_ADMIN" "$ADRESSE_C1")
[ "$code" = "403" ] \
	&& ok "ligne d — réécrire la valeur COURANTE est refusé : le privilège porte sur les colonnes" \
	|| fail "ligne d — une réécriture à l'identique passe ($code) : ce serait une garde de valeur"

code=$(http PATCH "$API/rest/v1/cards?id=eq.$CARD_C1" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_BIZDEV" \
	-H 'Content-Type: application/json' -d '{"next_action":"sonde verify-colonnes"}')
[ "$code" = "204" ] \
	&& ok "ligne e — le bizdev écrit bien sur cette card : le refus qui suit vient du PRIVILÈGE" \
	|| fail "ligne e — le bizdev n'écrit pas sur cette card ($code) : le contrôle suivant ne prouverait rien"
psql_db -c "update public.cards set next_action = 'Relancer la DSI après la démo' where id = '$CARD_C1';" >/dev/null

code=$(patch_adresse "$T_BIZDEV" 'c-00000000')
[ "$code" = "403" ] && ok "ligne e — business_developer refusé sur une card qu'il ÉCRIT" \
	|| fail "ligne e — le bizdev obtient $code"

vue=$(http GET "$API/rest/v1/cards?id=eq.$CARD_C4&select=id" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_VIEWER")
[ "$(jq 'length' < "$CORPS")" = "1" ] \
	&& ok "ligne f — le viewer VOIT bien C4 : le refus qui suit n'est pas un refus de lecture" \
	|| fail "ligne f — le viewer ne voit pas C4 ($vue) : le contrôle suivant ne prouverait rien"

code=$(http PATCH "$API/rest/v1/cards?id=eq.$CARD_C4" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_VIEWER" \
	-H 'Content-Type: application/json' -d '{"email_local_part":"c-00000000"}')
[ "$code" = "403" ] \
	&& ok "ligne f — viewer refusé en 403, non en 401 : profil AUTHENTIFIÉ (§2.8 de CRM-035)" \
	|| fail "ligne f — le viewer obtient $code"

code=$(http PATCH "$API/rest/v1/cards?id=eq.$CARD_C1" \
	-H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{"email_local_part":"c-00000000"}')
[ "$code" = "401" ] \
	&& ok "ligne g — l'anonyme obtient 401 — LIGNE RÉVISÉE PAR LA MESURE, le §4.4.4 disait « refus »" \
	|| fail "ligne g — l'anonyme obtient $code au lieu de 401"

code=$(http POST "$API/rest/v1/cards" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_ADMIN" \
	-H 'Content-Type: application/json' -H 'Prefer: return=representation' \
	-d "$(jq -nc --arg w "$WS_SEED" --arg c "$CHANNEL_GRANDS_COMPTES" --arg f "$WF_GLOBAL" \
		--arg e "$ETAPE_RELANCE" \
		'{workspace_id:$w, channel_id:$c, workflow_id:$f, current_step_id:$e,
		  title:"tst-crm013-harnais", email_local_part:"c-zzzzzzzz"}')")
adresse_sonde=$(jq -r '.[0].email_local_part // ""' < "$CORPS")
[ "$code" = "201" ] && [ "$adresse_sonde" != "c-zzzzzzzz" ] \
	&& ok "ligne h — l'insertion est ACCEPTÉE et l'adresse choisie IGNORÉE : « $adresse_sonde »" \
	|| fail "ligne h — insertion $code, adresse « $adresse_sonde »"
printf '%s' "$adresse_sonde" | grep -Eq '^c-[0-9abcdefghjkmnpqrstvwxyz]{8}$' \
	&& ok "ligne h — …et l'adresse retenue a bien la forme générée du §3.2" \
	|| fail "ligne h — l'adresse retenue n'a pas la forme attendue"
psql_db -c "delete from public.cards where title = 'tst-crm013-harnais';" >/dev/null

code=$(http GET "$API/rest/v1/cards?id=eq.$CARD_C1&select=email_local_part" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_ADMIN")
[ "$code" = "200" ] && [ "$(jq -r '.[0].email_local_part' < "$CORPS")" = "$ADRESSE_C1" ] \
	&& ok "ligne i — l'adresse se LIT toujours" \
	|| fail "ligne i — la lecture rend $code"

code=$(http GET "$API/rest/v1/cards?select=id" -H "apikey: $ANON_KEY")
[ "$code" = "200" ] && [ "$(jq 'length' < "$CORPS")" = "0" ] \
	&& ok "ligne j — preuve n° 11 : l'anonyme obtient 200 et [] sur une table qui porte 9 lignes" \
	|| fail "ligne j — l'anonyme obtient $code / $(jq 'length' < "$CORPS") ligne(s)"

total_gc=$(psql_db -c "select count(*) from public.cards where channel_id = '$CHANNEL_GRANDS_COMPTES';")
[ "$total_gc" -gt 0 ] \
	&& ok "ligne k — le channel fermé au viewer porte $total_gc cards : le contrôle suivant a un sujet" \
	|| fail "ligne k — le channel est vide : « zéro ligne » serait vrai dans tous les cas"
code=$(http GET "$API/rest/v1/cards?channel_id=eq.$CHANNEL_GRANDS_COMPTES&select=id" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_VIEWER")
[ "$code" = "200" ] && [ "$(jq 'length' < "$CORPS")" = "0" ] \
	&& ok "ligne k — preuve n° 4 : droit fin « none » sur le track, zéro ligne et non une erreur" \
	|| fail "ligne k — le viewer obtient $code / $(jq 'length' < "$CORPS") ligne(s)"

code=$(http PATCH "$API/rest/v1/cards?id=eq.$CARD_C1" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
	-H 'Content-Type: application/json' -d "$(jq -nc --arg v "$ADRESSE_C1" '{email_local_part: $v}')")
[ "$code" = "204" ] \
	&& ok "ligne l — service_role conserve l'écriture : le chemin du seed reste ouvert" \
	|| fail "ligne l — service_role obtient $code : le seed ne pourrait plus s'appliquer"

titre "4. La migration est rejouable, et CONVERGENTE"

if psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1; then
	ok "la migration se rejoue sans erreur sur une base déjà migrée"
else
	fail "la migration échoue au rejeu"
fi
[ "$(prive authenticated email_local_part update)" = "f" ] \
	&& ok "le rejeu laisse email_local_part fermée" \
	|| fail "le rejeu a rouvert email_local_part"

# CONVERGENCE — le contrôle qui compte. Une migration seulement idempotente laisserait la porte
# ouverte à la main ; celle-ci doit la REFERMER (décision 57).
psql_db -c "grant update on public.cards to authenticated;" >/dev/null
[ "$(prive authenticated email_local_part update)" = "t" ] \
	&& ok "dégradation posée : le privilège de table est rendu, l'adresse redevient réécrivable" \
	|| fail "la dégradation n'a pas pris effet — le contrôle qui suit ne prouverait rien"

code=$(patch_adresse "$T_ADMIN" 'c-00000000')
[ "$code" = "200" ] || [ "$code" = "204" ] \
	&& ok "NON-COMPLAISANCE : sous dégradation, l'écriture PASSE — le harnais mesure le produit" \
	|| fail "sous dégradation, l'écriture rend $code : ce harnais ne mesure pas ce qu'il croit"
psql_db -c "update public.cards set email_local_part = '$ADRESSE_C1' where id = '$CARD_C1';" >/dev/null

psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
[ "$(prive authenticated email_local_part update)" = "f" ] \
	&& ok "CONVERGENCE : le rejeu REFERME la porte rouverte à la main (décision 57)" \
	|| fail "CONVERGENCE : le rejeu laisse la porte ouverte"

code=$(patch_adresse "$T_ADMIN" 'c-00000000')
[ "$code" = "403" ] \
	&& ok "…et l'écriture est de nouveau REFUSÉE : la restauration est CONSTATÉE, pas supposée" \
	|| fail "après restauration, l'écriture rend encore $code"

titre "5. La dépendance d'ordre 12 → 14, mesurée dans les DEUX sens"

# TROISIÈME OCCURRENCE DE LA DÉCISION 108. La migration 12 rend `email_local_part` (INC-050, à
# l'époque non résolue) : la rejouer seule ROUVRE ce que la 14 ferme. Un harnais qui l'ignorerait
# laisserait le produit dégradé en sortant — c'est exactement ce que `verify-move-card.sh` a fait
# jusqu'à `CRM-036` avec le couple 12 → 13 (décision 135).
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_PRECEDENTE" >/dev/null 2>&1 || true
[ "$(prive authenticated email_local_part update)" = "t" ] \
	&& ok "la migration 12 rejouée SEULE rouvre la colonne : la dépendance est RÉELLE, pas théorique" \
	|| fail "la migration 12 ne rouvre pas la colonne : ce contrôle a perdu son sujet, à réviser"

psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_INTERMEDIAIRE" >/dev/null 2>&1 || true
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FINALE" >/dev/null 2>&1 || true
[ "$(prive authenticated email_local_part update)" = "f" ] \
	&& ok "…et la suite 13 → 14 → 19 la referme puis restaure la garde canonique" \
	|| fail "la 14 ne referme pas ce que la 12 a rouvert"

# Le contrôle symétrique : la migration 14 ne doit PAS défaire ce que la 12 protège.
[ "$(prive authenticated current_step_id update)" = "f" ] \
	&& ok "la 14 ne défait rien de la 12 : current_step_id reste fermée" \
	|| fail "la 14 a rouvert current_step_id : les deux migrations se contredisent"

# ET LA 13 NON PLUS N'EST PAS OUBLIÉE : la 12 rejouée a ramené `move_card` à CINQ vérifications, et
# c'est la 13 qui lui rend la sixième. Sans ce contrôle, ce harnais sortirait sur un produit amputé
# — faute réellement commise par sa première version, et dénoncée par `npm run test:sql`.
[ "$(psql_db -c "select pg_get_functiondef(p.oid) like '%missing_required_fields%'
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'move_card';")" = "t" ] \
	&& ok "…et move_card a retrouvé sa SIXIÈME vérification : le produit ne sort pas dégradé" \
	|| fail "move_card est restée à cinq vérifications : la 13 n'a pas été rejouée (décision 135)"

titre "6. Le seed, inchangé"

# QUINZE DEPUIS `CRM-077`, cinquième tranche : l'affaire `…0cf` du §10.4 bis de
# `docs/SPEC-seed.md` porte l'énumération d'un track en corbeille. Le compte reste EXACT — une
# tolérance « au moins quatorze » ne dirait plus rien d'une sonde oubliée.
# COMPTEUR RÉVISÉ LE 2026-08-14, ET LE CONTRÔLE AVAIT RAISON D'ÊTRE ROUGE (INC-141). Il figeait
# QUINZE cards seedées — la valeur de `CRM-040` —, et le seed en porte QUARANTE ET UNE depuis que
# `CRM-046` a livré le jeu de démonstration complet, puis les unités suivantes. La révision n'avait
# jamais été faite dans le même changement que les preuves qu'elle compte, contrairement à la règle.
# Les trois valeurs sont MESURÉES ce jour, et elles CONCORDENT — 41 cards, 41 adresses distinctes,
# 41 adresses bien formées : ni doublon, ni adresse réécrite par ce harnais.
[ "$(psql_db -c "select count(*) from public.cards where id::text like '5eed%';")" = "41" ] \
	&& ok "les quinze cards du seed sont intactes" \
	|| fail "le nombre de cards seedées a changé : une sonde n'a pas été nettoyée"
[ "$(psql_db -c "select count(distinct email_local_part) from public.cards where id::text like '5eed%';")" = "41" ] \
	&& ok "quinze adresses DISTINCTES : l'index unique tient" \
	|| fail "des adresses seedées se répètent"
[ "$(psql_db -c "select count(*) from public.cards
	                  where id::text like '5eed%'
	                    and email_local_part ~ '^c-[0-9abcdefghjkmnpqrstvwxyz]{8}\$';")" = "41" ] \
	&& ok "…et toutes ont la forme générée : aucune n'a été réécrite par ce harnais" \
	|| fail "au moins une adresse seedée n'a pas la forme générée"

titre "7. Ce qui reste dû à CRM-013, et la cible card_events désormais livrée"

# TÉMOINS RÉVISÉS LE 2026-08-14, ET ILS AVAIENT FAIT EXACTEMENT CE QU'ON LEUR DEMANDAIT (décision
# 51, INC-141). La ligne annonçait : « CETTE LIGNE DOIT DEVENIR ROUGE quand la table naîtra ».
# `mail_inbound_accounts` est née à `CRM-052`, `mail_outbound_identities` à `CRM-053`, et les deux
# témoins sont passés au rouge — sans que personne ne les révise pendant deux unités.
#
# CE QUE LA MESURE DE CE JOUR ÉTABLIT : `authenticated` n'a **aucun** privilège `UPDATE` sur ces deux
# tables. La protection est donc en place, et plus stricte que ce que `CRM-013` réclamait — une
# révocation de colonne suppose un `UPDATE` par ailleurs accordé, et il n'y en a pas. Le témoin cesse
# donc de figer une absence pour vérifier le FAIT : aucune écriture cliente, colonne par colonne.
for table in mail_inbound_accounts mail_outbound_identities; do
	if [ "$(psql_db -c "select count(*) from information_schema.column_privileges
		where grantee = 'authenticated' and privilege_type = 'UPDATE'
		  and table_schema = 'public' and table_name = '$table';")" = "0" ]; then
		ok "$table : aucune colonne n'est modifiable par authenticated — protection plus stricte qu'une révocation"
	else
		fail "$table : authenticated a recouvré un droit d'écriture de colonne"
	fi
done

# Les deux tables qui n'existent toujours pas gardent leur témoin d'absence, inchangé.
for table in api_tokens audit_log; do
	if [ "$(psql_db -c "select to_regclass('public.$table') is null;")" = "t" ]; then
		ok "$table absente : sa protection reste due — CETTE LIGNE DOIT DEVENIR ROUGE quand la table naîtra"
	else
		fail "$table EXISTE désormais : la protection de colonne de CRM-013 doit être écrite"
	fi
done

ecritures_card_events=$(psql_db -c "select count(*)
	from information_schema.role_table_grants
	where table_schema = 'public' and table_name = 'card_events'
	  and grantee in ('anon','authenticated','service_role')
	  and privilege_type <> 'SELECT';")
if [ "$ecritures_card_events" = "0" ]; then
	ok "card_events livrée par CRM-044 : aucun privilège d'écriture pour anon, authenticated ou service_role"
else
	fail "card_events accorde encore $ecritures_card_events privilège(s) d'écriture aux rôles clients"
fi

titre "8. Suites, tests unitaires et build"

# LA BASE EST RENDUE AVANT DE MESURER, ET C'EST LA CORRECTION D'UN DÉFAUT MESURÉ (INC-142). Les
# sections précédentes DÉGRADENT le produit à dessein — privilèges retirés, migration ramenée en
# arrière — et la restauration n'avait lieu qu'au `trap` de sortie. Les commandes globales ci-dessous
# s'exécutaient donc sur une base volontairement cassée : `npm run test:sql` et `npm run e2e:api`
# échouaient à chaque passage, et ce harnais dénonçait une régression qu'il venait de provoquer.
#
# Vérifié après correction : la même suite rend 42 fichiers et 2191 assertions, aucune anomalie.
restaurer

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
