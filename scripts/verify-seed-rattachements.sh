#!/usr/bin/env bash
# @verifies CRM-111 (docs/BACKLOG.md) — tranche T8 : les cinq situations du §12 de docs/SPEC-rattachements.md, telles que
#           le seed les pose (docs/SPEC-seed.md §36), lues HORS INTERFACE par les vrais jetons des trois profils
# @verifies docs/SPEC-rattachements.md §4 (un rattachement illisible est masqué, existence comprise) ; CLAUDE.md §10
#
# Ce harnais ne réécrit rien. Il lit, sous le jeton de Camille (administratrice), de Driss (business developer) et de
# Farida (lectrice), les deux affaires du §36 :
#   1. la billetterie a deux rattachements, dans deux tracks, avec deux responsables, deux montants et deux étapes ;
#   2. l'infogérance a un rattachement archivé et un actif ;
#   3. l'infogérance a un rattachement en sommeil, l'échéance dans le futur ;
#   4. les deux rattachements de la billetterie suivent le workflow global, avec deux valeurs de `source` ;
#   5. la lectrice lit la billetterie par « Refonte de site » seulement, et une seule valeur de bloc ;
#   6. le board de « Grands comptes » (rattachements actifs, non archivés) rend la billetterie, pas l'infogérance archivée
#      ou endormie ailleurs — sous le jeton de l'administratrice.
# Usage : scripts/verify-seed-rattachements.sh (la pile debout et seedée)

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/sso.sh
sso_env_charger .env

# Les deux lectures du `.env`, comme `scripts/verify-seed-demo.sh`.
env_value() {
	sed -n "s/^[[:space:]]*$1=//p" .env | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
require_env() {
	local value
	value=$(env_value "$1")
	[ -n "$value" ] || { echo "ERREUR : variable '$1' absente ou vide dans .env." >&2; exit 1; }
	printf '%s' "$value"
}
ANON_KEY=$(require_env ANON_KEY)
API="http://127.0.0.1:$(require_env KONG_HTTP_PORT)"
GRANDS_COMPTES=5eed0000-0000-4000-8000-000000000032
REFONTE=5eed0000-0000-4000-8000-000000000034
MAINTENANCE=5eed0000-0000-4000-8000-000000000035
WF_GLOBAL=5eed0000-0000-4000-8000-000000000051
SOURCE=5eed0000-0000-4000-8000-000000000082
BILLETTERIE='Plateforme de billetterie — Musée des Confluences'
INFOGERANCE='Infogérance applicative — Groupe Ardent'

checks=0
failures=0
ok() { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
lire() { # $1 = jeton, $2 = chemin
	curl -s "$API$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1"
}
encode() { jq -rn --arg t "$1" '$t|@uri'; }

ADMIN=$(sso_jeton_interne "$API" "$ANON_KEY" 'admin@p2enjoy.test')
BIZDEV=$(sso_jeton_interne "$API" "$ANON_KEY" 'bizdev@p2enjoy.test')
LECTRICE=$(sso_jeton_interne "$API" "$ANON_KEY" 'viewer@p2enjoy.test')

rattachements() { # $1 = jeton, $2 = titre
	lire "$1" "/rest/v1/card_placements?select=id,channel_id,workflow_id,current_step_id,owner_id,amount,archived_at,snoozed_until,affaire:cards!inner(id,title)&affaire.title=eq.$(encode "$2")&order=channel_id"
}

# 1 et 4 — la billetterie, sous l'administratrice.
billetterie=$(rattachements "$ADMIN" "$BILLETTERIE")
resume=$(jq -r --arg gc "$GRANDS_COMPTES" --arg rf "$REFONTE" '[.[] | (if .channel_id == $gc then "gc" elif .channel_id == $rf then "rf" else "?" end)
	+ ":" + .current_step_id[-2:] + ":" + .owner_id[-2:] + ":" + ((.amount // 0) | tonumber | floor | tostring)] | sort | join(" ")' <<< "$billetterie")
[ "$resume" = "gc:63:11:48000 rf:62:12:36000" ] \
	&& ok "1. la billetterie : deux tracks, deux étapes, deux responsables, deux montants ($resume)" \
	|| fail "1. la billetterie : « $resume », attendu « gc:63:11:48000 rf:62:12:36000 »"
[ "$(jq -r --arg wf "$WF_GLOBAL" '[.[] | select(.workflow_id == $wf)] | length' <<< "$billetterie")" = "2" ] \
	&& ok "4. ses deux rattachements suivent le workflow global" || fail "4. ses rattachements ne suivent pas tous deux le workflow global"
id_billetterie=$(jq -r '.[0].affaire.id' <<< "$billetterie")
valeurs=$(lire "$ADMIN" "/rest/v1/card_field_values?select=value&field_id=eq.$SOURCE&card_id=eq.$id_billetterie&order=value" | jq -c '[.[].value]')
[ "$valeurs" = '["recommandation","salon"]' ] \
	&& ok "4. deux valeurs de bloc différentes pour « source » : $valeurs" || fail "4. valeurs de « source » : $valeurs"

# 2 et 3 — l'infogérance, sous l'administratrice.
infogerance=$(rattachements "$ADMIN" "$INFOGERANCE")
etats=$(jq -r --arg gc "$GRANDS_COMPTES" --arg rf "$REFONTE" --arg mt "$MAINTENANCE" '[.[] | (if .channel_id == $gc then "gc" elif .channel_id == $rf then "rf" elif .channel_id == $mt then "mt" else "?" end)
	+ ":" + (if .archived_at != null then "archive" elif .snoozed_until != null then "sommeil" else "actif" end)] | sort | join(" ")' <<< "$infogerance")
[ "$etats" = "gc:sommeil mt:actif rf:archive" ] \
	&& ok "2 et 3. l'infogérance : active, archivée et en sommeil ($etats)" || fail "2 et 3. l'infogérance : « $etats »"
futur=$(jq -r --arg gc "$GRANDS_COMPTES" '.[] | select(.channel_id == $gc) | .snoozed_until' <<< "$infogerance")
[ "$(date -u -d "$futur" +%s)" -gt "$(date -u +%s)" ] \
	&& ok "3. l'échéance du sommeil est dans le futur ($futur)" || fail "3. l'échéance du sommeil est passée ($futur)"

# 5 — la lectrice ne lit qu'un rattachement de la billetterie, et qu'une valeur de bloc ; rien de « Grands comptes ».
vue=$(rattachements "$LECTRICE" "$BILLETTERIE" | jq -c '[.[].channel_id]')
[ "$vue" = "[\"$REFONTE\"]" ] && ok "5. la lectrice lit la billetterie par « Refonte de site » seulement" || fail "5. la lectrice lit : $vue"
valeurs_lectrice=$(lire "$LECTRICE" "/rest/v1/card_field_values?select=value&field_id=eq.$SOURCE&card_id=eq.$id_billetterie" | jq -c '[.[].value]')
[ "$valeurs_lectrice" = '["recommandation"]' ] \
	&& ok "5. et la seule valeur de bloc de ce rattachement" || fail "5. valeurs lues par la lectrice : $valeurs_lectrice"
infogerance_lectrice=$(rattachements "$LECTRICE" "$INFOGERANCE" | jq -r --arg gc "$GRANDS_COMPTES" '[.[] | select(.channel_id == $gc)] | length')
[ "$infogerance_lectrice" = "0" ] && ok "5. le rattachement endormi de « Grands comptes » lui reste masqué" \
	|| fail "5. la lectrice lit un rattachement de « Grands comptes »"

# Driss, business developer : il lit les deux rattachements actifs de la billetterie.
[ "$(rattachements "$BIZDEV" "$BILLETTERIE" | jq -r 'length')" = "2" ] \
	&& ok "Driss lit les deux rattachements de la billetterie" || fail "Driss ne lit pas les deux rattachements de la billetterie"

# 6 — la lecture du board de « Grands comptes » : rattachements actifs et éveillés.
board=$(lire "$ADMIN" "/rest/v1/card_placements?select=affaire:cards!inner(title,deleted_at)&channel_id=eq.$GRANDS_COMPTES&archived_at=is.null&or=(snoozed_until.is.null,snoozed_until.lt.now())&affaire.deleted_at=is.null" | jq -r '[.[].affaire.title]')
jq -e --arg b "$BILLETTERIE" 'index($b) != null' <<< "$board" >/dev/null \
	&& ok "6. le board de « Grands comptes » rend la billetterie" || fail "6. la billetterie manque au board de « Grands comptes »"
jq -e --arg i "$INFOGERANCE" 'index($i) == null' <<< "$board" >/dev/null \
	&& ok "6. et pas l'infogérance, qui y dort" || fail "6. l'infogérance endormie paraît au board de « Grands comptes »"

printf '\n'
if [ "$failures" -eq 0 ]; then printf '\033[32m%s\033[0m\n' "$checks contrôles, aucune anomalie."; exit 0; fi
printf '\033[31m%s\033[0m\n' "$checks contrôles, $failures anomalie(s)."
exit 1
