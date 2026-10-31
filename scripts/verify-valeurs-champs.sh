#!/usr/bin/env bash
# @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.3.3 : `move_card` désigne le rattachement ; dégradations par définition en base,
#           réparation par reconstruction (INC-304, docs/SPEC-test-harness.md §3.6)
# @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.3.6 : la politique d'insertion juge le rattachement ; son constat de
#           restauration compare l'expression à celle lue à l'entrée (docs/SPEC-rattachements.md §4)
# @verifies CRM-036 (docs/BACKLOG.md) — Definition of Done des valeurs de formulaire
# @verifies docs/SPEC-form-composer.md §6.2 (modèle), §6.3 (clés composites), §6.4 (la validation
#           est un trigger), §6.5 (types), §6.6 (« renseigné »), §6.7 (la sixième vérification),
#           §6.9 (autorisations), §6.10 (contrat d'API), §6.11 (seed), §7.2 (preuves)
# @verifies docs/SPEC-permissions-rls.md §3.7 (`app.can_write_card`), §4, §7 (refus n° 4, n° 11)
# @verifies docs/SPEC-workflow-engine.md §5.3, §5.7 (la sixième vérification)
# @verifies docs/SPEC-seed.md §2.13 (valeurs du seed)
# @verifies docs/INCONSISTENCY_REPORT.md INC-025, INC-033, INC-037 (aggravé), INC-047 (**close**),
#           INC-053 (`user` non résolu), INC-054 (`value` nullable)
# @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — tranche T4 : jetons par la vraie
#           connexion LeLabs et l'échangeur de session, plus par GoTrue
# @verifies CRM-111 T2.4.4 (docs/BACKLOG.md) — les colonnes de rattachement se lisent et s'écrivent sur card_placements
#           (docs/SPEC-rattachements.md §3.2, §5)
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

# @spec CRM-115 (docs/BACKLOG.md) tranche T4 — docs/SPEC-pile-par-session.md §3 : les fichiers de travail vivent dans le
# `P2ENJOY_TMP` de l'emplacement de la pile, jamais dans un `/tmp` que deux sessions partageraient.
# shellcheck source=scripts/lib/emplacement.sh
source scripts/lib/emplacement.sh
P2ENJOY_TMP=$(emplacement_tmp "${P2ENJOY_ENV_FILE:-.env}")

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
# shellcheck source=scripts/lib/sso.sh
source scripts/lib/sso.sh
sso_env_charger .env
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

TEST_FILE=supabase/tests/0014_valeurs_champs.test.sql
# RÉVISÉ PAR `CRM-111` T2.3.3 (INC-304, décisions 682, 701, 704). Ce harnais rejouait la 12, la 13, la 14, la 47, la 19
# et la 35 — pour dégrader `move_card` et le validateur, puis pour les restaurer —, chaque maillon ajouté après qu'un
# rejeu incomplet eut laissé le produit amputé (décisions 108, 135, 143, 145, 447, INC-153, INC-154). Depuis que `move_card`
# désigne le rattachement (migration 114), ces fichiers ne se rejouent plus sur une base à jour : « cannot change name of
# input parameter » en cours de fichier, APRÈS en avoir appliqué une partie — et la 13 redéfinit au passage
# `app.can_write_card` dans sa forme d'origine, qui lit `cards`. Désormais : une fonction se dégrade et se restaure
# depuis sa définition EN BASE (`scripts/lib/degradation.sh`) ; une STRUCTURE dégradée — contrainte, clé, privilège — se
# répare par la reconstruction de la base depuis le répertoire (`scripts/lib/reconstruction.sh`, docs/SPEC-test-harness.md
# §3.6). Plus aucun fichier de migration n'est rejoué ici.
# shellcheck source=scripts/lib/conteneur.sh
source scripts/lib/conteneur.sh
# shellcheck source=scripts/lib/degradation.sh
source scripts/lib/degradation.sh
# shellcheck source=scripts/lib/reconstruction.sh
source scripts/lib/reconstruction.sh
# @spec CRM-115 (docs/BACKLOG.md) T2, docs/SPEC-pile-par-session.md §6 : le conteneur se désigne par son service.
DB_CONTAINER=$(conteneur db)

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

# INSTANTANÉ D'OUVERTURE — INC-191, décision 497. La section 6 comparait la population de
# `card_field_values` à « 21 », valeur juste à `CRM-036` et fausse depuis que les tranches de
# `CRM-060` ont seedé les valeurs de leurs deux sélecteurs : MESURÉ le 2026-08-21, la base en porte
# VINGT-TROIS. Ce harnais écrit et efface des valeurs pour éprouver le validateur ; ce que la
# section prétend tenir est qu'il rend le seed tel qu'il l'a trouvé, non qu'il vaut un nombre écrit
# ici. Le compte est donc relevé avant le premier geste.
VALEURS_A_L_OUVERTURE=$(psql_db -c "select count(*) from public.card_field_values;")
CARDS_VALUEES_A_L_OUVERTURE=$(psql_db -c "select count(distinct card_id) from public.card_field_values;")


CORPS=$P2ENJOY_TMP/p2enjoy-valeurs-body
http() {
	local method=$1 url=$2
	shift 2
	curl -s -o "$CORPS" -w '%{http_code}' -X "$method" "$url" "$@"
}

# `CRM-092` T4 (docs/SPEC-session-sso.md §13) : le jeton est le jeton INTERNE, obtenu par la vraie
# connexion LeLabs et l'échangeur de session (`scripts/lib/sso.sh`), comme celui de la webapp. Il vit
# 300 s au plus ; une connexion refusée rend un jeton vide, que l'appelant constate.
jeton_de() {
	sso_jeton_interne "$API" "$ANON_KEY" "$1" 2>/dev/null || true
}

# Le ménage est posé AVANT toute création : une interruption ne doit jamais laisser une valeur de
# preuve derrière elle, ni une card déplacée. Le seed est un contrat maintenu.
menage() {
	psql_db -c "delete from public.card_field_values
	             where card_id = '$CARD_C6' and field_id in ('$CHAMP_LIEN', '$CHAMP_BUDGET');" \
		>/dev/null 2>&1 || true
	psql_db -c "update public.card_placements set current_step_id = '$ETAPE_RELANCE', position = 2 where card_id = '$CARD_C2' and current_step_id <> '$ETAPE_RELANCE';" >/dev/null 2>&1 || true
}

# LA POLITIQUE D'INSERTION D'ORIGINE, relue en base avant toute dégradation : la dégradation 3 la remplace, et le
# `trap` la rétablit telle qu'elle était, sans rejouer de migration.
POLITIQUE_INSERTION=$(psql_db -c "select pg_get_expr(polwithcheck, polrelid) from pg_policy
                                   where polname = 'card_field_values_insertion'
                                     and polrelid = 'public.card_field_values'::regclass;")
restaurer_politique() {
	[ -n "$POLITIQUE_INSERTION" ] || return 0
	psql_db -c "drop policy if exists card_field_values_insertion on public.card_field_values;
	            create policy card_field_values_insertion on public.card_field_values
	              for insert to authenticated with check ($POLITIQUE_INSERTION);" >/dev/null 2>&1
}
trap 'menage; degradations_restaurer; restaurer_politique; rm -f "$CORPS"; rm -rf "$DEGRADATIONS_DOSSIER"' EXIT
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

titre "2. La structure se reconstruit depuis le répertoire, et la reconstruction RÉPARE"

# RÉVISÉ PAR `CRM-111` T2.3.3 (INC-304, décision 682). Cette section rejouait la 13 et sa chaîne pour prouver qu'elle se
# réapplique et qu'elle CONVERGE — qu'une structure dégradée à la main est réparée. La 13 ne se rejoue plus sur une base à
# jour (le paramètre de `move_card` a changé de nom), et la propriété qui compte en production est celle du RÉPERTOIRE :
# le runner n'y rejoue jamais un fichier, il construit la base dans l'ordre. Elle se prouve donc par la reconstruction :
# la base reconstruite porte la MÊME empreinte que la base d'ouverture, et trois dégradations de structure posées à la
# main — l'unicité retirée (décision 57), la clé composite réduite à une clé simple sous le même nom (décision 78), un
# privilège relâché (décision 134) — sont réparées. L'ordre 12 → 13 que la section mesurait n'existe plus : la sixième
# vérification appartient à la définition en vigueur de `move_card`, et la section 7 la dégrade là où elle vit.
#
# L'empreinte inclut la définition de `move_card` : une reconstruction qui la rendrait différente le dirait.
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
# `CRM-111` T2.4.5 (migration 0134) : l'unicité (identifiant, workflow) sur laquelle s'appuient les valeurs est celle du
# RATTACHEMENT — `card_field_values_placement_workflow_fk` la référence, et le `cascade` l'emporte avec elle.
psql_db -c "alter table public.card_placements drop constraint card_placements_id_workflow_key cascade;" >/dev/null
psql_db -c "
	alter table public.card_field_values
		drop constraint if exists card_field_values_field_id_workflow_id_fkey;
	alter table public.card_field_values
		add constraint card_field_values_field_id_workflow_id_fkey
		foreign key (field_id) references public.form_fields (id) on delete cascade;
" >/dev/null
psql_db -c "grant delete on public.card_field_values to authenticated, anon;" >/dev/null
[ "$(psql_db -c "select count(*) from pg_constraint where conname in ('card_placements_id_workflow_key',
                  'card_field_values_placement_workflow_fk');")" = "0" ] \
	&& [ "$(psql_db -c "select has_table_privilege('authenticated','public.card_field_values','DELETE');")" = "t" ] \
	&& ok "trois dégradations de structure posées : unicité retirée, clé composite réduite, privilège relâché" \
	|| fail "les dégradations de structure n'ont pas pris : le contrôle qui suit ne prouverait rien"

if reconstruire_base_dev > "$P2ENJOY_TMP/p2enjoy-valeurs-reconstruction.log" 2>&1; then
	ok "la base se reconstruit depuis le répertoire, seed compris"
else
	fail "la reconstruction a échoué — voir $P2ENJOY_TMP/p2enjoy-valeurs-reconstruction.log"
	tail -5 "$P2ENJOY_TMP/p2enjoy-valeurs-reconstruction.log"
fi

[ "$(psql_db -c "select count(*) from pg_constraint
                  where (conrelid = 'public.card_placements'::regclass and conname = 'card_placements_id_workflow_key')
                     or (conrelid = 'public.card_field_values'::regclass
                         and conname = 'card_field_values_placement_workflow_fk');")" = "2" ] \
	&& ok "l'unicité retirée à la main sur le rattachement est **rétablie**, et la clé des valeurs avec elle : le répertoire répare, il ne constate pas" \
	|| fail "l'unicité retirée n'est pas rétablie"
definition=$(psql_db -c "select pg_get_constraintdef(oid) from pg_constraint
                          where conname = 'card_field_values_field_id_workflow_id_fkey';")
case "$definition" in
	*'(field_id, workflow_id)'*)
		ok "une clé composite **dégradée en clé simple** sous le même nom est réparée (décision 78) : la définition "\
"réelle est comparée, pas le nom" ;;
	*) fail "la clé dégradée n'a pas été réparée : « $definition »" ;;
esac
[ "$(psql_db -c "select has_table_privilege('authenticated','public.card_field_values','DELETE')::text
                     || '/' ||
                        has_table_privilege('anon','public.card_field_values','INSERT')::text;")" \
	= "false/false" ] \
	&& ok "un privilège relâché à la main est **retiré** — décision 134, le défaut que la suite pgTAP de cette unité a trouvé" \
	|| fail "les privilèges relâchés n'ont pas été retirés"

apres=$(empreinte)
[ "$avant" = "$apres" ] \
	&& ok "la base reconstruite porte la MÊME empreinte que la base d'ouverture : contraintes, politiques, triggers, "\
"validateur, \`can_write_card\` et \`move_card\`" \
	|| fail "la base reconstruite diffère de la base d'ouverture : l'empreinte a changé"

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

# LA DÉGRADATION EST ICI, au plus près de ce qu'elle éprouve. RÉVISÉE PAR `CRM-111` T2.3.3 : la migration 13 rejouée seule
# ramenait le validateur d'AVANT la résolution, mais elle ne se rejoue plus sur une base à jour. Le validateur est
# dégradé dans sa définition EN BASE : la résolution des types `contact` et `user` est court-circuitée, et rien d'autre.
# RÉVISÉE PAR `CRM-111` T2.4.5 : depuis la migration 0131 (`CRM-097`), la résolution vit dans `app.valider_valeur_champ`,
# que le déclencheur appelle et que les modèles d'affaires partagent ; c'est elle qui se dégrade.
if degradation_fonction 'app.valider_valeur_champ(public.form_fields,jsonb,uuid)' \
	$'\n\t\t\tif v_champ.type = \'contact\' then\n' \
	$'\n\t\t\tif true then null; elsif v_champ.type = \'contact\' then\n'; then
	code=$(poster_valeur "$T_ADMIN" "$CARD_C6" "$CHAMP_SONDE_CONTACT" "\"$UUID_MORT\"")
	[ "$code" != "400" ] \
		&& ok "dégradation constatée : la résolution court-circuitée, l'uuid mort repasse (code $code) — les "\
"quatre contrôles ci-dessus mesurent bien la résolution de la migration 47" \
		|| fail "dégradation sans effet : le refus tient alors que la résolution est court-circuitée"
else
	fail "la résolution du validateur n'a pas pu être dégradée : contrôle non concluant"
fi
degradations_restaurer

code=$(poster_valeur "$T_ADMIN" "$CARD_C6" "$CHAMP_SONDE_CONTACT" "\"$UUID_MORT\"")
[ "$code" = "400" ] \
	&& ok "restauration constatée, non supposée : la définition d'origine réappliquée, l'uuid mort est de nouveau refusé" \
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
	# `CRM-111` T2.3.3 : `move_card` désigne le RATTACHEMENT de l'affaire (docs/SPEC-rattachements.md §5).
	local rattachement
	rattachement=$(psql_db -c "select coalesce(app.card_first_placement('$2')::text, '$2');")
	http POST "$API/rest/v1/rpc/move_card" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" \
		-H 'Content-Type: application/json' \
		-d "$(jq -nc --arg p "$rattachement" --arg s "$3" '{p_placement: $p, to_step_id: $s}')"
}

code=$(deplacer "$T_ADMIN" "$CARD_C1" "$ETAPE_NEGOCIATION")
message=$(jq -r '.message // empty' < "$CORPS")
detail=$(jq -r '.details // empty' < "$CORPS")
etape=$(psql_db -c "select current_step_id from public.card_placements where card_id = '$CARD_C1';")
[ "$code" = "400" ] && [ "$message" = "missing_required_fields" ] && [ "$detail" = "budget" ] \
	&& [ "$etape" = "$ETAPE_RELANCE" ] \
	&& ok "un champ \`required\` VIDE refuse la transition : 400, message stable, \`DETAIL\` portant "\
"la clé, et la card **n'a pas bougé**" \
	|| fail "refus n° 6 : code $code, message « $message », detail « $detail », étape $etape"

# LE CAS SYMÉTRIQUE. Sans lui, le contrôle précédent serait vert sur une garde qui refuse TOUT.
code=$(deplacer "$T_ADMIN" "$CARD_C2" "$ETAPE_NEGOCIATION")
etape=$(psql_db -c "select current_step_id from public.card_placements where card_id = '$CARD_C2';")
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

# RETOURNÉS LE 2026-08-21 — INC-191, décision 497. Les deux premiers comptaient une population et
# figeaient son nombre ; ils mesurent désormais l'invariant de la section — ce harnais rend le seed
# tel qu'il l'a trouvé — contre l'instantané d'ouverture, sans aucun littéral.
[ "$valeurs" = "$VALEURS_A_L_OUVERTURE" ] \
	&& ok "les $VALEURS_A_L_OUVERTURE valeurs seedées sont intactes : ce harnais n'en a laissé ni ajoutée ni perdue" \
	|| fail "la population de card_field_values a changé pendant ce harnais : $VALEURS_A_L_OUVERTURE → $valeurs"
[ "$cards" = "$CARDS_VALUEES_A_L_OUVERTURE" ] \
	&& ok "réparties sur les mêmes $CARDS_VALUEES_A_L_OUVERTURE cards qu'à l'ouverture" \
	|| fail "cards portant des valeurs : $CARDS_VALUEES_A_L_OUVERTURE → $cards"

# LES TROIS SUIVANTS NE COMPTENT PLUS, ILS EXIGENT. Ce que le §6.11 demande est qu'une donnée
# PERMANENTE exerce chacune de ces trois règles — non qu'il en existe exactement une. Figer « une »
# faisait rougir le harnais le jour où le seed en poserait une seconde, ce qui n'apprendrait rien du
# validateur. L'exigence est donc « au moins une », et elle reste non complaisante : zéro fait
# échouer, et c'est le seul cas où la règle cesserait d'être démontrée.
[ "$vides" -ge 1 ] \
	&& ok "dont **au moins une vidée explicitement** ($vides) : une ligne présente n'est pas une valeur renseignée, "\
"et c'est démontré par une donnée permanente (§6.6)" \
	|| fail "aucune valeur vide dans le seed : la règle du §6.6 n'est plus exercée par une donnée permanente"
[ "$archive" -ge 1 ] \
	&& ok "au moins une valeur portée par un champ **archivé** ($archive) : l'archivage retire le champ des formulaires, "\
"il n'efface pas les réponses (décision 129)" \
	|| fail "aucune valeur sur champ archivé : la règle de la décision 129 n'est plus exercée"
[ "$exigeantes" -ge 1 ] \
	&& ok "au moins une transition porte une liaison ($exigeantes) : le second membre de l'union a une donnée "\
"qui l'exerce (docs/SPEC-workflow-engine.md §5.9)" \
	|| fail "aucune liaison de champ exigé : le second membre de l'union du §3.5 n'est plus exercé"

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
# RÉVISÉE PAR `CRM-111` T2.3.3 : `move_card` était ramenée à sa version de la migration 12 par un rejeu, qui ne passe plus
# (paramètre renommé par la 114). La sixième vérification est retirée de la définition EN BASE, et d'elle seule : le
# produit redevient celui d'avant `CRM-036`, et le contrôle du §5 doit le voir.
if degradation_fonction 'public.move_card(uuid,uuid,text)' \
	'if v_manquants is not null and array_length(v_manquants, 1) > 0 then' 'if false then'; then
	code=$(deplacer "$T_ADMIN" "$CARD_C1" "$ETAPE_NEGOCIATION")
	[ "$code" = "200" ] \
		&& ok "dégradation 2 constatée : la sixième vérification retirée de \`move_card\`, le déplacement vers une "\
"étape \`required\` PASSE de nouveau — c'est l'état exact d'avant \`CRM-036\`" \
		|| fail "dégradation 2 sans effet : code $code"
else
	fail "dégradation 2 : la sixième vérification n'a pas pu être retirée — contrôle non concluant"
fi
degradations_restaurer
psql_db -c "update public.card_placements set current_step_id = '$ETAPE_RELANCE', position = 1 where card_id = '$CARD_C1';" >/dev/null

# --- Dégradation 3 : la politique d'écriture est ouverte à tout membre ----------------------------
# `app.can_write_card` est remplacée par `app.can_read_card` : un `viewer` écrirait.
psql_db -c "
	drop policy card_field_values_insertion on public.card_field_values;
	create policy card_field_values_insertion on public.card_field_values
		for insert to authenticated with check (app.can_read_card(card_id));
" >/dev/null
code=$(poster_valeur "$T_VIEWER" "$CARD_C6" "$CHAMP_LIEN" '"https://viewer.test/x"')
[ "$code" = "201" ] \
	&& ok "dégradation 3 constatée : politique d'insertion adossée à la LECTURE, le \`viewer\` écrit "\
"(code $code) — le contrôle du §4 mesure bien la règle et non un refus général" \
	|| fail "dégradation 3 sans effet : code $code"
psql_db -c "delete from public.card_field_values
             where card_id = '$CARD_C6' and field_id = '$CHAMP_LIEN';" >/dev/null 2>&1 || true

titre "8. Restauration, constatée et non supposée"

# RÉVISÉE PAR `CRM-111` T2.3.3 : les fonctions dégradées sont réappliquées depuis leur définition d'origine, relue en
# base, et la politique depuis son expression d'origine — aucun fichier de migration n'est rejoué.
# RÉVISÉE PAR `CRM-111` T2.3.6 : le constat compare l'expression restaurée à celle lue à l'entrée, à l'octet près — la
# politique juge le channel du RATTACHEMENT depuis T2.3.6, et un motif écrit en dur (`can_write_card`) aurait rougi.
degradations_restaurer
restaurer_politique

restaure=$(psql_db -c "
	select (select pg_get_expr(polwithcheck, polrelid) = \$politique\$$POLITIQUE_INSERTION\$politique\$
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
	&& ok "restauration constatée : la politique d'insertion est revenue à son expression d'origine, le trigger de "\
"validation est actif, et \`move_card\` porte de nouveau sa sixième vérification" \
	|| fail "restauration incomplète : « $restaure », attendu « true/true/true »"

# ET LA COLONNE DE `CRM-013` EST RESTÉE FERMÉE : ce harnais ne rejoue plus la 12, qui la rouvrait, et le constat tient
# pour qu'aucun retour en arrière ne passe inaperçu.
[ "$(psql_db -c "select has_column_privilege('authenticated', 'public.cards', 'email_local_part', 'update');")" = "f" ] \
	&& ok "…et \`cards.email_local_part\` est refermée : le harnais ne laisse pas le produit dégradé" \
	|| fail "\`email_local_part\` est OUVERTE : le produit sort dégradé"

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
