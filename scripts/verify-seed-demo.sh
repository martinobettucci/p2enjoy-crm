#!/usr/bin/env bash
# @verifies CRM-046 (docs/BACKLOG.md) — Definition of Done du jeu de démonstration complet
# @verifies docs/SPEC-seed.md §9.1 (les trois manques mesurés), §9.2 (levée par convergence),
#           §9.3 (les cinq cards), §9.4 (identifiants résolus), §9.5 (formulaire vide du dérivé),
#           §9.6 (valeurs, commentaires, événements), §9.7 (ce que chaque profil voit),
#           §9.8 (convergence et reproductibilité), §9.9 (les quatorze preuves)
# @verifies docs/SPEC-cards.md §9 (contrat des cards du seed), §9.1 (l'obstruction levée)
# @verifies docs/SPEC-permissions-rls.md §3 ligne f (channel rouvert sous un track fermé)
# @verifies docs/INCONSISTENCY_REPORT.md INC-046 (non levée), INC-037 (champs non copiés),
#           INC-075 (droit sans chemin de navigation), INC-021 (aucun écran de connexion)
#
# Rejoue les quatorze preuves du §9.9 de `docs/SPEC-seed.md`, **hors interface**, contre l'API
# réelle et la base réelle.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les cinq cards ajoutées existent, avec leurs identifiants fixes, leur channel et leur étape ;
#   2. les sept étapes du workflow GLOBAL portent chacune au moins une card ACTIVE ;
#   3. le workflow DÉRIVÉ porte au moins une card active à au moins deux étapes distinctes ;
#   4. tout channel ACTIF porte au moins une card active ;
#   5. les deux cards du workflow dérivé désignent la COPIE, jamais le workflow global ;
#   6. aucune valeur de formulaire n'existe sur le workflow dérivé — INC-037, figée ;
#   7. les quatre valeurs ajoutées existent, dont le champ exigé par l'arête ;
#   8. les volumes : 14 cards, 12 actives, une archivée, une en corbeille ;
#   9. 18 valeurs, 5 commentaires, 38 événements ;
#  10. le seed est REJOUABLE alors que des cards occupent « prospection » ;
#  11. une dérive du rattachement de « prospection » est RATTRAPÉE ;
#  12. pour chacun des trois profils, tout channel actif lisible rend au moins une card active ;
#  13. INC-075 est mesurée et figée : le `viewer` lit les cards de « prospection » et ne lit pas
#      son track ;
#  14. l'empreinte du §9.8 est stable d'un rejeu du seed à l'autre.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve **aucun écran**. « Aucun écran vide » est vérifié au niveau des DONNÉES que chaque
# jeton réel obtient, pas au niveau du rendu : la webapp est un appelant anonyme faute d'écran de
# connexion (INC-021), et aucun parcours connecté n'est observable. La formulation exacte du
# contrat vérifié est au §9.7.
#
# La preuve n° 14 du §9.9 — empreinte égale de part et d'autre d'un `resetMe.sh` COMPLET — n'est
# **pas** jouée ici : `resetMe.sh` détruit le cluster et redémarre la pile, ce qu'un harnais de
# vérification n'a pas à faire sans confirmation humaine (`CLAUDE.md` §9). Ce script prouve la
# forme faible — empreinte stable d'un rejeu du seed à l'autre — et la forme forte reste à jouer à
# la main, par `./resetMe.sh --yes` encadré de `--empreinte`.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-seed-demo.sh
#   scripts/verify-seed-demo.sh --empreinte   n'affiche que l'empreinte du §9.8, et sort
#   scripts/verify-seed-demo.sh --rapide      saute les rejeux du seed (preuves 10, 11, 14)

set -euo pipefail

cd "$(dirname "$0")/.."

SEED=supabase/seed/apply-seed.sh
DB_CONTAINER=p2enjoy-db

WS_ID=5eed0000-0000-4000-8000-000000000001
WF_GLOBAL=5eed0000-0000-4000-8000-000000000051
CH_PROSPECTION=5eed0000-0000-4000-8000-000000000031
TRACK_CONSEIL=5eed0000-0000-4000-8000-000000000021
CARD_CA=5eed0000-0000-4000-8000-0000000000ca
CARD_CB=5eed0000-0000-4000-8000-0000000000cb
CARD_CC=5eed0000-0000-4000-8000-0000000000cc
CARD_CD=5eed0000-0000-4000-8000-0000000000cd
CARD_CE=5eed0000-0000-4000-8000-0000000000ce
CHAMP_LIEN=5eed0000-0000-4000-8000-000000000086
CHAMP_MOTIF=5eed0000-0000-4000-8000-000000000084

EMPREINTE_SEULE=false
RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--empreinte) EMPREINTE_SEULE=true ;;
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,53p' "$0"; exit 0 ;;
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

ANON_KEY=$(require_env ANON_KEY)
SERVICE_ROLE_KEY=$(require_env SERVICE_ROLE_KEY)
API="http://127.0.0.1:$(require_env KONG_HTTP_PORT)"

failures=0
checks=0

ok()    { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail()  { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }
info()  { printf '  %s\n' "$1"; }

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

# Lecture par l'API avec un jeton donné. Rend le corps sur la sortie standard.
lire() {
	local jeton=$1 chemin=$2
	curl -s "$API$chemin" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $jeton"
}

jeton_de() {
	curl -s -X POST "$API/auth/v1/token?grant_type=password" \
		-H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
		-d "$(jq -nc --arg m "$1@p2enjoy.test" --arg p 'SeedDev2026Local' '{email: $m, password: $p}')" \
		| jq -r '.access_token // empty'
}

# ---------------------------------------------------------------------------------------------
# L'empreinte du §9.8.
# ---------------------------------------------------------------------------------------------
# Elle porte tout ce qui doit être identique d'une reconstruction à l'autre, et RIEN de ce que le
# produit tire lui-même. Sont donc exclus, et la liste est exhaustive : l'identifiant et
# l'horodatage du workflow dérivé et de ses sept étapes, les identifiants de `card_events`, et
# toutes les colonnes `created_at`, `updated_at`, `derived_at`, `entered_step_at`.
#
# Les deux cards du workflow dérivé sont comparées par la CLÉ DE NŒUD de leur étape, jamais par son
# identifiant — c'est exactement la contrainte du §9.4, et une empreinte qui l'ignorerait serait
# rouge à chaque reconstruction sans qu'aucune donnée n'ait bougé.
empreinte() {
	psql_db <<-'SQL'
		\pset footer off
		select 'card|' || c.id || '|' || c.channel_id || '|' || n.key || '|' || c.title
		       || '|' || coalesce(c.owner_id::text, '-') || '|' || coalesce(c.amount::text, '-')
		       || '|' || c.currency || '|' || c.position || '|' || c.email_local_part
		       || '|' || (c.archived_at is not null) || '|' || (c.deleted_at is not null)
		       || '|' || (w.scope = 'track')
		  from cards c
		  join workflow_steps s on s.id = c.current_step_id
		  join workflow_nodes_catalog n on n.id = s.node_id
		  join workflows w on w.id = c.workflow_id
		 order by c.id;
		select 'valeur|' || v.card_id || '|' || v.field_id || '|' || coalesce(v.value::text, 'null')
		  from card_field_values v order by v.card_id, v.field_id;
		select 'commentaire|' || k.id || '|' || k.card_id || '|' || k.author_id || '|' || k.body
		       || '|' || (k.edited_at is not null) || '|' || (k.deleted_at is not null)
		  from card_comments k order by k.id;
		select 'evenement|' || e.card_id || '|' || e.type || '|' || coalesce(e.actor_id::text, '-')
		  from card_events e order by e.card_id, e.type, e.created_at;
		select 'channel|' || ch.id || '|' || ch.slug || '|' || ch.position
		       || '|' || (ch.archived_at is not null) || '|' || (wf.scope = 'track')
		  from channels ch join workflows wf on wf.id = ch.workflow_id order by ch.id;
	SQL
}

# La même empreinte, SANS la timeline. Elle sert à la non-complaisance : une dégradation réparée
# rétablit l'ÉTAT, jamais la MÉMOIRE — les triggers de `CRM-044` inscrivent chaque écriture, et
# c'est le comportement voulu. L'écart de la timeline est alors mesuré à part, à la valeur près.
empreinte_hors_evenements() {
	empreinte | grep -v '^evenement|'
}

if [ "$EMPREINTE_SEULE" = true ]; then
	empreinte | sha256sum | cut -d' ' -f1
	exit 0
fi

printf '\033[1mPreuves du jeu de démonstration complet — CRM-046, docs/SPEC-seed.md §9\033[0m\n'
info "Cible : $API"

# --- 0. Traçabilité et prérequis ---------------------------------------------------------------

titre "0. Traçabilité et prérequis"

if head -3 "$SEED" | grep -q '@spec'; then
	ok "$SEED porte son commentaire @spec"
else
	fail "$SEED ne porte pas de commentaire @spec"
fi

if grep -q 'CARDS_DERIVE=(' "$SEED"; then
	ok "le seed déclare le contrat des cards du workflow dérivé"
else
	fail "le seed ne déclare aucun contrat CARDS_DERIVE — §9.3"
fi

if grep -q 'convergence par état' "$SEED"; then
	ok "le seed nomme la convergence par état de la section 7 — §9.2"
else
	fail "le seed ne nomme pas la convergence par état — §9.2"
fi

if docker exec "$DB_CONTAINER" true 2>/dev/null; then
	ok "le conteneur $DB_CONTAINER répond"
else
	fail "le conteneur $DB_CONTAINER ne répond pas : la pile n'est pas démarrée"
	printf '\n\033[31m%s\033[0m\n' "Pile absente : les preuves ne peuvent pas être jouées."
	exit 1
fi

COPIE_ID=$(psql_db -c "select id from workflows where derived_from_workflow_id = '$WF_GLOBAL' order by created_at limit 1")
if [ -n "$COPIE_ID" ]; then
	ok "la copie de portée track existe — identifiant résolu, jamais figé (§9.4)"
else
	fail "aucune copie de portée track : les preuves 3, 5 et 6 sont sans objet"
fi

# --- 1. Les cinq cards ajoutées ----------------------------------------------------------------

titre "1. Preuve n° 1 — les cinq cards du §9.3 existent"

verifier_card() {
	local id=$1 channel_attendu=$2 noeud_attendu=$3 libelle=$4
	local ligne
	ligne=$(psql_db -c "
		select c.channel_id || '|' || n.key
		  from cards c
		  join workflow_steps s on s.id = c.current_step_id
		  join workflow_nodes_catalog n on n.id = s.node_id
		 where c.id = '$id'")
	if [ "$ligne" = "$channel_attendu|$noeud_attendu" ]; then
		ok "$libelle : channel et étape conformes ($noeud_attendu)"
	else
		fail "$libelle : attendu « $channel_attendu|$noeud_attendu », lu « ${ligne:-aucune ligne} »"
	fi
}

verifier_card "$CARD_CA" "$CH_PROSPECTION" prospection '…0ca Cadrage data — Groupe Vallier'
verifier_card "$CARD_CB" "$CH_PROSPECTION" negociation '…0cb Assistant IA support — Nordis'
verifier_card "$CARD_CC" 5eed0000-0000-4000-8000-000000000034 realisation '…0cc Portail adhérents — MGEN Loire'
verifier_card "$CARD_CD" 5eed0000-0000-4000-8000-000000000032 livre '…0cd Socle analytique — Vertuo'
verifier_card "$CARD_CE" 5eed0000-0000-4000-8000-000000000036 perdu '…0ce Cursus DevSecOps — Institut Berthier'

# --- 2. Toutes les étapes du workflow global portent une card active ---------------------------

titre "2. Preuve n° 2 — les sept étapes du workflow global portent une card ACTIVE"

vides=$(psql_db -c "
	select coalesce(string_agg(n.key, ', ' order by s.position), '')
	  from workflow_steps s
	  join workflow_nodes_catalog n on n.id = s.node_id
	 where s.workflow_id = '$WF_GLOBAL'
	   and not exists (
	         select 1 from cards c
	          where c.current_step_id = s.id
	            and c.archived_at is null and c.deleted_at is null)")
if [ -z "$vides" ]; then
	ok "aucune étape du workflow global sans card active"
else
	fail "étapes sans card active : $vides — §9.1, le manque que CRM-046 devait fermer"
fi

nb_etapes=$(psql_db -c "select count(*) from workflow_steps where workflow_id = '$WF_GLOBAL'")
if [ "$nb_etapes" = '7' ]; then
	ok "le workflow global porte bien sept étapes"
else
	fail "le workflow global porte $nb_etapes étapes, sept attendues"
fi

# --- 3. Le workflow dérivé est exercé ----------------------------------------------------------

titre "3. Preuve n° 3 — le workflow dérivé porte des cards à au moins deux étapes"

etapes_peuplees=$(psql_db -c "
	select count(distinct c.current_step_id)
	  from cards c
	 where c.workflow_id = '$COPIE_ID'
	   and c.archived_at is null and c.deleted_at is null")
if [ "${etapes_peuplees:-0}" -ge 2 ]; then
	ok "le workflow dérivé porte des cards actives à $etapes_peuplees étapes distinctes"
else
	fail "le workflow dérivé n'est peuplé qu'à ${etapes_peuplees:-0} étape(s) — §9.1"
fi

# --- 4. Aucun channel actif vide ---------------------------------------------------------------

titre "4. Preuve n° 4 — tout channel ACTIF porte au moins une card active"

channels_vides=$(psql_db -c "
	select coalesce(string_agg(ch.slug, ', ' order by ch.position), '')
	  from channels ch
	 where ch.archived_at is null
	   and not exists (
	         select 1 from cards c
	          where c.channel_id = ch.id
	            and c.archived_at is null and c.deleted_at is null)")
if [ -z "$channels_vides" ]; then
	ok "aucun channel actif sans card active"
else
	fail "channels actifs vides : $channels_vides — l'écran vide que le §9.1 proscrit"
fi

archive_reste_vide=$(psql_db -c "
	select count(*) from cards c
	  join channels ch on ch.id = c.channel_id
	 where ch.archived_at is not null")
if [ "$archive_reste_vide" = '0' ]; then
	ok "le channel archivé « appels-offres » ne porte aucune card — §9.3, voulu"
else
	fail "$archive_reste_vide card(s) dans un channel archivé : un écran que le produit ne montre pas"
fi

# --- 5. Les cards du dérivé désignent la copie -------------------------------------------------

titre "5. Preuve n° 5 — les deux cards du dérivé désignent la COPIE, jamais le workflow global"

for carte in "$CARD_CA" "$CARD_CB"; do
	wf=$(psql_db -c "select workflow_id from cards where id = '$carte'")
	if [ "$wf" = "$COPIE_ID" ]; then
		ok "…${carte: -3} porte le workflow dérivé (résolu à l'exécution — §9.4)"
	elif [ "$wf" = "$WF_GLOBAL" ]; then
		fail "…${carte: -3} porte le workflow GLOBAL : elle n'apparaîtrait dans aucune colonne du board"
	else
		fail "…${carte: -3} porte « ${wf:-aucun} », ni la copie ni le workflow global"
	fi
done

# Le contrat du seed ne doit citer aucun identifiant de la copie : il serait faux sur toute autre
# base (§9.4). Le contrôle porte sur le fichier, pas sur la base.
if grep -q "$COPIE_ID" "$SEED"; then
	fail "le seed cite en dur l'identifiant de la copie : il serait faux sur toute autre base (§9.4)"
else
	ok "le seed ne cite aucun identifiant de la copie — les clés sont résolues (§9.4)"
fi

# --- 6. Le formulaire du dérivé est vide, et c'est figé ----------------------------------------

titre "6. Preuve n° 6 — aucun champ, donc aucune valeur, sur le workflow dérivé (INC-037)"

champs_derive=$(psql_db -c "select count(*) from form_fields where workflow_id = '$COPIE_ID'")
if [ "$champs_derive" = '0' ]; then
	ok "le workflow dérivé ne porte aucun champ : copy_workflow_to_track n'en copie pas (INC-037)"
else
	fail "le workflow dérivé porte $champs_derive champ(s) : INC-037 a bougé, le §9.5 doit être réécrit"
fi

valeurs_derive=$(psql_db -c "select count(*) from card_field_values where workflow_id = '$COPIE_ID'")
if [ "$valeurs_derive" = '0' ]; then
	ok "aucune valeur de formulaire sur le workflow dérivé — §9.5, constaté et non compensé"
else
	fail "$valeurs_derive valeur(s) sur le workflow dérivé : le §9.5 est faux"
fi

# --- 7. Les quatre valeurs ajoutées ------------------------------------------------------------

titre "7. Preuve n° 7 — les quatre valeurs du §9.6"

verifier_valeur() {
	local card=$1 champ=$2 libelle=$3
	local v
	v=$(psql_db -c "select value::text from card_field_values where card_id = '$card' and field_id = '$champ'")
	if [ -n "$v" ] && [ "$v" != 'null' ]; then
		ok "$libelle : renseignée ($v)"
	else
		fail "$libelle : absente ou vide (« ${v:-aucune ligne} »)"
	fi
}

verifier_valeur "$CARD_CC" "$CHAMP_LIEN" '…0cc lien-proposition, exigé par l’arête require_fields'
verifier_valeur "$CARD_CC" 5eed0000-0000-4000-8000-000000000081 '…0cc budget'
verifier_valeur "$CARD_CD" 5eed0000-0000-4000-8000-000000000081 '…0cd budget de l’affaire gagnée'
verifier_valeur "$CARD_CE" "$CHAMP_MOTIF" '…0ce motif-perte, exigé par l’étape'

# --- 8 et 9. Les volumes -----------------------------------------------------------------------

titre "8 et 9. Preuves n° 8 et 9 — les volumes du §9.3 et du §9.6"

verifier_volume() {
	local libelle=$1 attendu=$2 requete=$3 lu
	lu=$(psql_db -c "$requete")
	if [ "$lu" = "$attendu" ]; then
		ok "$libelle : $lu"
	else
		fail "$libelle : $lu, $attendu attendu(s)"
	fi
}

verifier_volume 'cards'                14 'select count(*) from cards'
verifier_volume 'cards actives'        12 "select count(*) from cards where archived_at is null and deleted_at is null"
verifier_volume 'card archivée'         1 'select count(*) from cards where archived_at is not null'
verifier_volume 'card en corbeille'     1 'select count(*) from cards where deleted_at is not null'
verifier_volume 'valeurs de formulaire' 18 'select count(*) from card_field_values'
verifier_volume 'commentaires'           5 'select count(*) from card_comments'

# LES ÉVÉNEMENTS NE SE COMPTENT PAS EN CUMUL, ET C'EST MESURÉ — décision 226, seconde forme de la
# décision 210. Le §9.6 annonce 38 événements ; c'est vrai **au sortir d'un seed sur base neuve**,
# et faux dès la première écriture de qui que ce soit. La section 15 de ce harnais en écrit
# elle-même quatre à chaque exécution, et `e2e/api` en écrit à chaque passage : une assertion
# d'égalité sur le total serait rouge par la seule existence des autres preuves.
#
# Ce qui est STABLE, et qui est donc assert : un `created` par card, exactement, puisqu'une card
# naît une fois. Le reste est vérifié en MINORANT, ce qui suffit à prouver que le seed a bien
# produit ce qu'il annonce sans mentir sur ce qu'une base vivante devient.
verifier_volume 'événements created (un par card, invariant)' 14 "select count(*) from card_events where type = 'created'"
verifier_volume 'cards sans événement created'                 0 "select count(*) from cards c where not exists (select 1 from card_events e where e.card_id = c.id and e.type = 'created')"
verifier_volume 'cards avec plus d’un created'                 0 "select count(*) from (select card_id from card_events where type = 'created' group by card_id having count(*) > 1) d"

verifier_minorant() {
	local libelle=$1 minimum=$2 requete=$3 lu
	lu=$(psql_db -c "$requete")
	if [ "${lu:-0}" -ge "$minimum" ]; then
		ok "$libelle : $lu (≥ $minimum, cumul croissant — décision 226)"
	else
		fail "$libelle : $lu, au moins $minimum attendu(s)"
	fi
}

verifier_minorant 'événements, tous types'  38 'select count(*) from card_events'
verifier_minorant 'événements field_changed' 18 "select count(*) from card_events where type = 'field_changed'"
verifier_minorant 'événements moved'          2 "select count(*) from card_events where type = 'moved'"
verifier_minorant 'événements assigned'       2 "select count(*) from card_events where type = 'assigned'"
verifier_minorant 'événements channel_changed' 2 "select count(*) from card_events where type = 'channel_changed'"

# --- 12 et 13. Ce que chaque profil voit -------------------------------------------------------

titre "12. Preuve n° 12 — pour les trois profils, tout channel actif lisible rend une card active"

for compte in admin bizdev viewer; do
	jeton=$(jeton_de "$compte")
	if [ -z "$jeton" ]; then
		fail "$compte : connexion impossible — les preuves 12 et 13 sont sans objet"
		continue
	fi

	channels=$(lire "$jeton" "/rest/v1/channels?select=id,slug&archived_at=is.null" | jq -r '.[] | .id + "|" + .slug')
	if [ -z "$channels" ]; then
		fail "$compte : aucun channel actif lisible — la RLS ou le seed ont changé"
		continue
	fi

	vides=''
	while IFS='|' read -r cid cslug; do
		[ -n "$cid" ] || continue
		n=$(lire "$jeton" "/rest/v1/cards?select=id&channel_id=eq.$cid&archived_at=is.null&deleted_at=is.null" | jq -r 'length')
		[ "${n:-0}" -ge 1 ] || vides="$vides $cslug"
	done <<< "$channels"

	if [ -z "$vides" ]; then
		ok "$compte : les $(printf '%s\n' "$channels" | wc -l | tr -d ' ') channels actifs lisibles rendent tous au moins une card active"
	else
		fail "$compte : channel(s) actif(s) lisible(s) sans card active :$vides"
	fi
done

titre "13. Preuve n° 13 — INC-075, mesurée et figée"

jeton_viewer=$(jeton_de viewer)
if [ -n "$jeton_viewer" ]; then
	voit_track=$(lire "$jeton_viewer" "/rest/v1/tracks?select=id&id=eq.$TRACK_CONSEIL" | jq -r 'length')
	voit_channel=$(lire "$jeton_viewer" "/rest/v1/channels?select=id&id=eq.$CH_PROSPECTION" | jq -r 'length')
	voit_cards=$(lire "$jeton_viewer" "/rest/v1/cards?select=id&channel_id=eq.$CH_PROSPECTION&archived_at=is.null&deleted_at=is.null" | jq -r 'length')

	if [ "$voit_track" = '0' ]; then
		ok "le viewer ne lit PAS le track « conseil-ia » — track_members.access = none"
	else
		fail "le viewer lit le track « conseil-ia » : INC-075 a changé de nature, le §9.7 doit être réécrit"
	fi

	if [ "$voit_channel" = '1' ]; then
		ok "le viewer lit le channel « prospection » — channel_members.access = member, ligne f du §3"
	else
		fail "le viewer ne lit pas « prospection » : la réouverture par droit fin a cessé de fonctionner"
	fi

	if [ "${voit_cards:-0}" -ge 2 ]; then
		ok "le viewer lit les $voit_cards cards de « prospection » par son droit fin — et aucun écran ne l'y mène (INC-075)"
	else
		fail "le viewer ne lit que ${voit_cards:-0} card(s) de « prospection », deux attendues"
	fi
else
	fail "connexion du viewer impossible : la preuve n° 13 est sans objet"
fi

# --- 10, 11 et 14. Convergence, rattrapage et empreinte ----------------------------------------

if [ "$RAPIDE" = true ]; then
	titre "10, 11 et 14 — non jouées (--rapide)"
	info "Les rejeux du seed sont sautés. L'unité ne peut PAS être déclarée vérifiée sur cette base."
else
	titre "10 et 14. Preuves n° 10 et 14 — le seed est rejouable avec des cards dans « prospection »"

	avant=$(empreinte | sha256sum | cut -d' ' -f1)
	if "$SEED" > /tmp/verify-seed-demo-rejeu.log 2>&1; then
		ok "le seed se rejoue en sortie 0 alors que « prospection » porte des cards — §9.2"
	else
		fail "le seed échoue au rejeu : voir /tmp/verify-seed-demo-rejeu.log"
	fi

	if grep -q 'AUCUNE écriture (convergence par état' /tmp/verify-seed-demo-rejeu.log; then
		ok "la section 7 n'a fait aucune écriture — chemin court emprunté"
	else
		fail "la section 7 a écrit alors que la base est conforme : le §9.2 n'est pas appliqué"
	fi

	if grep -q '23503' /tmp/verify-seed-demo-rejeu.log; then
		fail "le rejeu a produit un 23503 : l'obstruction du §9.2 est de retour"
	else
		ok "aucun 23503 au rejeu"
	fi

	apres=$(empreinte | sha256sum | cut -d' ' -f1)
	if [ "$avant" = "$apres" ]; then
		ok "empreinte du §9.8 inchangée par le rejeu : $avant"
	else
		fail "empreinte modifiée par le rejeu — avant $avant, après $apres"
	fi

	titre "11. Preuve n° 11 — une dérive du rattachement de « prospection » est rattrapée"

	# La dérive est posée par la VRAIE route, avec la clé de service : le seed doit la rattraper
	# comme il rattrape une valeur modifiée à la main. Elle est réparable parce qu'elle ne déplace
	# pas le workflow d'un channel peuplé — elle change le NOM de la copie, colonne que le §9.2
	# range parmi les cinq qui décident de la conformité.
	nom_origine=$(psql_db -c "select name from workflows where id = '$COPIE_ID'")
	curl -s -o /dev/null -X PATCH "$API/rest/v1/workflows?id=eq.$COPIE_ID" \
		-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
		-H 'Content-Type: application/json' -d '{"name": "Copie renommée à la main"}'
	nom_devie=$(psql_db -c "select name from workflows where id = '$COPIE_ID'")
	if [ "$nom_devie" = 'Copie renommée à la main' ]; then
		ok "dérive réellement posée : la copie porte « $nom_devie »"
	else
		fail "la dérive n'a pas pu être posée : la preuve n° 11 ne prouverait rien"
	fi

	if "$SEED" > /tmp/verify-seed-demo-rattrapage.log 2>&1; then
		ok "le seed se rejoue en sortie 0 malgré la dérive"
	else
		fail "le seed échoue sur une dérive rattrapable : voir /tmp/verify-seed-demo-rattrapage.log"
	fi

	nom_rendu=$(psql_db -c "select name from workflows where id = '$COPIE_ID'")
	if [ "$nom_rendu" = "$nom_origine" ]; then
		ok "la copie est ramenée à « $nom_rendu » — convergence, §9.2"
	else
		fail "la copie porte « $nom_rendu » après rejeu, « $nom_origine » attendu"
	fi

	wf_apres=$(psql_db -c "select workflow_id from channels where id = '$CH_PROSPECTION'")
	if [ "$wf_apres" = "$COPIE_ID" ]; then
		ok "« prospection » suit toujours la copie après réparation"
	else
		fail "« prospection » suit « ${wf_apres:-aucun} » : le rattachement a été perdu"
	fi

	final=$(empreinte | sha256sum | cut -d' ' -f1)
	if [ "$final" = "$avant" ]; then
		ok "empreinte rétablie après dérive et rattrapage : $final"
	else
		fail "empreinte non rétablie — attendue $avant, lue $final"
	fi
fi

# --- 15. Non-complaisance ----------------------------------------------------------------------
# Un harnais vert ne vaut que si l'on a établi qu'il sait être rouge. Chaque dégradation ci-dessous
# est posée par la VRAIE route, avec la clé de service, puis réparée par le seed lui-même — ce qui
# éprouve du même coup sa convergence. L'empreinte du §9.8 est reconstatée après chaque
# restauration : un harnais qui laisse la base dégradée derrière lui est pire que pas de harnais
# du tout (décisions 143, 157).
#
# Les dégradations sont choisies RÉPARABLES PAR LE SEED. Supprimer une card ne l'est pas : son
# `email_local_part` est frappé par le trigger de la migration 11 et ne se retrouve jamais à
# l'identique — l'empreinte resterait rouge après réparation, et le harnais mentirait sur ce qu'il
# a mesuré.

if [ "$RAPIDE" = true ]; then
	titre "15 — non-complaisance non jouée (--rapide)"
else
	titre "15. Non-complaisance — chaque dégradation DOIT rendre un contrôle rouge"

	reference_hors_evenements=$(empreinte_hors_evenements | sha256sum | cut -d' ' -f1)
	evenements_avant_degradation=$(psql_db -c 'select count(*) from card_events')

	patch_service() {
		curl -s -o /dev/null -X PATCH "$API/rest/v1/$1" \
			-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
			-H 'Content-Type: application/json' -d "$2"
	}

	# N1 — la seule card active de l'étape « Livré » est archivée. Le contrôle n° 2 doit la voir.
	patch_service "cards?id=eq.$CARD_CD" '{"archived_at": "2026-08-06T00:00:00Z"}'
	vides_degrade=$(psql_db -c "
		select coalesce(string_agg(n.key, ', ' order by s.position), '')
		  from workflow_steps s
		  join workflow_nodes_catalog n on n.id = s.node_id
		 where s.workflow_id = '$WF_GLOBAL'
		   and not exists (
		         select 1 from cards c
		          where c.current_step_id = s.id
		            and c.archived_at is null and c.deleted_at is null)")
	if [ "$vides_degrade" = 'livre' ]; then
		ok "N1 : « …0cd » archivée, l'étape « livre » redevient vide — le contrôle n° 2 mord"
	else
		fail "N1 : l'étape « livre » n'est pas signalée vide (« ${vides_degrade:-rien} ») : le contrôle n° 2 est complaisant"
	fi

	# N2 — le motif de perte est effacé. Le contrôle n° 7 doit le voir.
	patch_service "card_field_values?card_id=eq.$CARD_CE&field_id=eq.$CHAMP_MOTIF" '{"value": null}'
	motif_degrade=$(psql_db -c "select coalesce(value::text, 'null') from card_field_values where card_id = '$CARD_CE' and field_id = '$CHAMP_MOTIF'")
	if [ "$motif_degrade" = 'null' ]; then
		ok "N2 : « motif-perte » vidé — une ligne présente n'est PAS une valeur renseignée (§6.6)"
	else
		fail "N2 : la valeur n'a pas pu être vidée, la dégradation ne prouverait rien"
	fi

	# N3 — le rattachement de « prospection » NE PEUT PAS être dégradé tant que des cards
	# l'occupent : c'est INC-046 elle-même, et le refus est ici la preuve, pas l'obstacle.
	refus=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/rest/v1/channels?id=eq.$CH_PROSPECTION" \
		-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
		-H 'Content-Type: application/json' -d "$(jq -nc --arg wf "$WF_GLOBAL" '{workflow_id: $wf}')")
	if [ "$refus" = '409' ]; then
		ok "N3 : détacher « prospection » peuplé est refusé en $refus — INC-046 tient, elle n'est PAS levée"
	else
		fail "N3 : le détachement a rendu $refus, 409 attendu : la clé composite ne protège plus rien"
	fi

	# Réparation par le seed lui-même : c'est sa convergence qui est éprouvée ici.
	if "$SEED" > /tmp/verify-seed-demo-restauration.log 2>&1; then
		ok "N4 : le seed répare les deux dégradations en sortie 0"
	else
		fail "N4 : le seed échoue sur la réparation : voir /tmp/verify-seed-demo-restauration.log"
	fi

	# N5 — L'ÉTAT EST RÉTABLI, ET LA MÉMOIRE NE L'EST PAS. C'est le produit qui fonctionne, pas le
	# harnais qui échoue : archiver puis désarchiver une card, vider puis remplir une valeur, sont
	# quatre écritures que les triggers de `CRM-044` DOIVENT inscrire. Une empreinte qui reviendrait
	# à l'identique, événements compris, prouverait que la timeline ne voit pas ce qui se passe.
	#
	# La comparaison porte donc sur l'état — cards, valeurs, commentaires, channels — et l'écart de
	# la timeline est mesuré séparément, à la valeur près.
	restaure=$(empreinte_hors_evenements | sha256sum | cut -d' ' -f1)
	if [ "$restaure" = "$reference_hors_evenements" ]; then
		ok "N5 : état rétabli à l'identique après dégradation et réparation : $restaure"
	else
		fail "N5 : état NON rétabli — attendu $reference_hors_evenements, lu $restaure. La base reste dégradée."
	fi

	evenements_apres=$(psql_db -c 'select count(*) from card_events')
	ecart=$(( evenements_apres - evenements_avant_degradation ))
	if [ "$ecart" -eq 4 ]; then
		ok "N6 : la timeline a inscrit les $ecart écritures — archived, unarchived, deux field_changed"
	else
		fail "N6 : $ecart événement(s) inscrit(s), 4 attendus : la timeline ne voit pas tout ce qui se passe"
	fi

	types_ecart=$(psql_db -c "
		select coalesce(string_agg(distinct type, ','), '')
		  from (select type from card_events order by created_at desc limit 4) d")
	if [ "$types_ecart" = 'archived,field_changed,unarchived' ]; then
		ok "N7 : les quatre derniers événements sont bien ceux des dégradations ($types_ecart)"
	else
		fail "N7 : les quatre derniers événements sont « $types_ecart », inattendu"
	fi
fi

# --- Bilan --------------------------------------------------------------------------------------

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s\033[0m\n' "$checks contrôles, aucune anomalie."
	printf '%s\n' "Preuve n° 14 sous sa forme FORTE — empreinte de part et d'autre d'un ./resetMe.sh"
	printf '%s\n' "complet — non jouée par ce harnais : elle détruit le cluster (CLAUDE.md §9)."
	exit 0
fi

printf '\033[31m%s\033[0m\n' "$checks contrôles, $failures anomalie(s)."
exit 1
