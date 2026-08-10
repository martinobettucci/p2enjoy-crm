#!/usr/bin/env bash
# @verifies CRM-051 (docs/BACKLOG.md) — Definition of Done du socle du service `mail-sync`
# @verifies docs/SPEC-mail-subsystem.md §12.1 (runtime et durcissement), §12.2 (configuration),
#           §12.3 (santé et API interne), §12.4 (état durable et reprise), §12.5 (journaux),
#           §12.6 (preuves exigées)
# @verifies docs/JOURNAL.md décision 261 (aucun ordonnanceur dans le service), décision 310
#           (état de reprise minimal et prouvable), décision 311 (runtime épinglé),
#           décision 312 (client de test), décision 313 (aucun lifespan applicatif)
# @verifies docs/DAT.md §3.3 (service mail-sync) ; CLAUDE.md §10 (règle appliquée côté backend)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. `pytest mail-sync/tests` est vert, y compris la contre-preuve du `TestClient` ;
#   2. le service est déclaré dans l'assemblage COMMUN, donc présent en développement comme en
#      production, et les deux assemblages restent valides ;
#   3. le conteneur tourne, est sain, s'exécute sous un utilisateur non privilégié, avec racine
#      en lecture seule, capacités retirées et `no-new-privileges` ;
#   4. AUCUN port n'est publié : l'API n'est joignable que par le réseau Compose, et l'hôte se
#      voit refuser la connexion ;
#   5. la santé répond sans jeton, et le statut EXIGE le jeton : absent, faux et mal formé
#      donnent le même `401`, par une requête qui contourne toute interface ;
#   6. les routes de preuve sont `404` sous le profil `prod`, avec le bon jeton — vérifié sur un
#      conteneur réel issu de la MÊME image ;
#   7. l'arrêt puis le redémarrage du vrai conteneur conservent le checkpoint, incrémentent
#      `boot_count` d'exactement un et renouvellent `boot_id` ;
#   8. tout journal nominal est un JSON valide, sans secret, et sans ligne `WARNING` ou pire ;
#   9. chaque fichier livré par l'unité porte son commentaire de traçabilité ;
#  10. le jeton interne n'est versionné nulle part, et `.env.example` documente ses variables.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve **aucune synchronisation** : ni IMAP, ni SMTP, ni table métier n'existent dans
# cette unité. Les deux workers sont attendus dans l'état `waiting_for_configuration`, et le
# harnais échoue si l'un d'eux prétend autre chose. L'ingestion appartient à `CRM-054`.
#
# Le script ne démarre ni ne détruit la pile : `./runDev.sh` doit déjà tourner. Il arrête et
# redémarre le seul conteneur `mail-sync`, ce qu'exige la preuve de reprise, puis le laisse sain.
#
# Usage :
#   scripts/verify-mail-sync.sh
#   scripts/verify-mail-sync.sh --contre-epreuve   exige que les gardes mordent : jeton faux,
#                                                  profil prod, état corrompu sur une COPIE

set -euo pipefail

cd "$(dirname "$0")/.."

RACINE=$PWD
SERVICE=mail-sync
CONTENEUR=p2enjoy-mail-sync
IMAGE_BASE=python:3.13.13-slim-bookworm

CONTRE_EPREUVE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--contre-epreuve) CONTRE_EPREUVE=true ;;
		--help|-h) sed -n '2,43p' "$0"; exit 0 ;;
		*) echo "option inconnue « $1 ». Voir --help." >&2; exit 1 ;;
	esac
	shift
done

failures=0
checks=0

ok()    { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail()  { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }
info()  { printf '  %s\n' "$1"; }

compose_dev() {
	docker compose --env-file "$RACINE/.env" \
		-f "$RACINE/docker-compose.yml" -f "$RACINE/docker-compose.dev.yml" "$@"
}

lire_env() { sed -n "s/^${1}=//p" "$RACINE/.env" | head -1; }

JETON=$(lire_env MAIL_SYNC_INTERNAL_TOKEN)
RESEAU=$(docker inspect "$CONTENEUR" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null || true)

# Appelle l'API depuis un conteneur jetable placé sur le réseau Compose : c'est le seul chemin
# d'accès réel, et il prouve du même coup qu'aucun port n'est publié sur l'hôte.
#   appel_interne <méthode> <chemin> <en-tête Authorization ou vide> [corps JSON]
# Écrit « <code>\n<corps> » sur la sortie standard.
appel_interne() {
	local methode=$1 chemin=$2 autorisation=$3 corps=${4:-}
	docker run --rm --network "$RESEAU" \
		-e METHODE="$methode" -e CHEMIN="$chemin" \
		-e AUTORISATION="$autorisation" -e CORPS="$corps" \
		"$IMAGE_BASE" python -c '
import json, os, urllib.error, urllib.request

corps = os.environ["CORPS"].encode() or None
requete = urllib.request.Request(
    "http://mail-sync:8080" + os.environ["CHEMIN"],
    data=corps,
    method=os.environ["METHODE"],
)
if os.environ["AUTORISATION"]:
    requete.add_header("Authorization", os.environ["AUTORISATION"])
if corps:
    requete.add_header("Content-Type", "application/json")
try:
    with urllib.request.urlopen(requete, timeout=10) as reponse:
        print(reponse.status)
        print(reponse.read().decode())
except urllib.error.HTTPError as erreur:
    print(erreur.code)
    print(erreur.read().decode())
' 2>/dev/null
}

code_de()  { printf '%s\n' "$1" | head -1; }
corps_de() { printf '%s\n' "$1" | tail -n +2; }

json_champ() {
	printf '%s' "$1" | python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$2" 2>/dev/null || true
}

attendre_sante() {
	local reste=60
	while [ "$reste" -gt 0 ]; do
		case "$(docker inspect "$CONTENEUR" --format '{{.State.Health.Status}}' 2>/dev/null)" in
			healthy) return 0 ;;
		esac
		sleep 1
		reste=$((reste - 1))
	done
	return 1
}

printf '\033[1mPreuves de CRM-051 — socle du service mail-sync\033[0m\n'

# --- 1. Preuve unitaire -------------------------------------------------------------------------

titre "1. Preuve unitaire Python"

if [ -x "$RACINE/.venv/bin/python" ]; then
	PYTHON=$RACINE/.venv/bin/python
else
	PYTHON=python3
fi

if sortie_pytest=$("$PYTHON" -m pytest "$RACINE/mail-sync/tests" -q 2>&1); then
	ok "pytest mail-sync/tests : $(printf '%s' "$sortie_pytest" | tail -1)"
else
	fail "pytest mail-sync/tests échoue"
	printf '%s\n' "$sortie_pytest" | tail -20
fi

if printf '%s' "$sortie_pytest" | grep -q 'warning'; then
	fail "pytest signale des avertissements : la console doit rester silencieuse"
else
	ok "pytest ne produit aucun avertissement"
fi

# --- 2. Déclaration Compose ---------------------------------------------------------------------

titre "2. Déclaration dans les deux assemblages"

if grep -q '^  mail-sync:' "$RACINE/docker-compose.yml"; then
	ok "le service est déclaré dans l'assemblage COMMUN"
else
	fail "le service n'est pas dans docker-compose.yml : il manquerait à la production"
fi

if grep -q '^  mail-sync:' "$RACINE/docker-compose.dev.yml"; then
	fail "le service est redéclaré dans l'overlay de développement"
else
	ok "l'overlay de développement ne le redéclare pas"
fi

for assemblage in dev prod; do
	if docker compose --env-file "$RACINE/.env" -f "$RACINE/docker-compose.yml" \
		-f "$RACINE/docker-compose.$assemblage.yml" config >/dev/null 2>&1; then
		ok "l'assemblage $assemblage reste valide"
	else
		fail "l'assemblage $assemblage est invalide"
	fi
done

for assemblage in dev prod; do
	publies=$(docker compose --env-file "$RACINE/.env" -f "$RACINE/docker-compose.yml" \
		-f "$RACINE/docker-compose.$assemblage.yml" config --format json 2>/dev/null \
		| python3 -c '
import json, sys
services = json.load(sys.stdin)["services"]
print(len(services.get("mail-sync", {}).get("ports", [])))
' 2>/dev/null || echo "?")
	if [ "$publies" = 0 ]; then
		ok "assemblage $assemblage : aucun port publié pour mail-sync"
	else
		fail "assemblage $assemblage : mail-sync publie $publies port(s)"
	fi
done

# --- 3. Durcissement effectif du conteneur ------------------------------------------------------

titre "3. Durcissement du conteneur en marche"

if [ -z "$RESEAU" ]; then
	fail "le conteneur $CONTENEUR n'existe pas : lancez ./runDev.sh"
	printf '\n\033[31m%s contrôle(s) en échec sur %s.\033[0m\n' "$failures" "$checks"
	exit 1
fi

etat=$(docker inspect "$CONTENEUR" --format '{{.State.Health.Status}}')
[ "$etat" = healthy ] && ok "conteneur sain" || fail "conteneur dans l'état « $etat »"

utilisateur=$(docker exec "$CONTENEUR" id -u)
[ "$utilisateur" = 10001 ] \
	&& ok "le processus s'exécute sous l'uid 10001, non privilégié" \
	|| fail "le processus s'exécute sous l'uid $utilisateur"

lecture_seule=$(docker inspect "$CONTENEUR" --format '{{.HostConfig.ReadonlyRootfs}}')
[ "$lecture_seule" = true ] && ok "racine en lecture seule" || fail "racine inscriptible"

capacites=$(docker inspect "$CONTENEUR" --format '{{.HostConfig.CapDrop}}')
[ "$capacites" = "[ALL]" ] && ok "toutes les capacités Linux sont retirées" \
	|| fail "capacités retirées : $capacites"

options=$(docker inspect "$CONTENEUR" --format '{{.HostConfig.SecurityOpt}}')
case "$options" in
	*no-new-privileges:true*) ok "no-new-privileges est posé" ;;
	*) fail "no-new-privileges absent : $options" ;;
esac

if docker exec "$CONTENEUR" sh -c 'echo test > /tmp/preuve-ecriture' 2>/dev/null; then
	fail "la racine du conteneur accepte une écriture"
else
	ok "une écriture hors volume est refusée par le noyau"
fi

volume=$(docker inspect "$CONTENEUR" --format '{{range .Mounts}}{{.Type}}:{{.Name}}:{{.Destination}} {{end}}')
case "$volume" in
	*volume:p2enjoy-crm_mail-sync-state:/var/lib/p2enjoy-mail-sync*)
		ok "l'état repose sur un volume nommé" ;;
	*) fail "montage inattendu : $volume" ;;
esac

# --- 4. Aucun port publié -----------------------------------------------------------------------

titre "4. Le port n'est pas publié sur l'hôte"

if [ -z "$(docker port "$CONTENEUR")" ]; then
	ok "docker port ne rend aucune publication"
else
	fail "des ports sont publiés : $(docker port "$CONTENEUR" | tr '\n' ' ')"
fi

# Sonder « 127.0.0.1:8080 » ne prouverait rien : ce port de l'hôte appartient à Roundcube
# (`ROUNDCUBE_PORT`). La question est donc posée au conteneur, et non au port.
liaisons=$(docker inspect "$CONTENEUR" --format '{{json .NetworkSettings.Ports}}')
if printf '%s' "$liaisons" | grep -q 'HostPort'; then
	fail "le conteneur porte une liaison vers un port de l'hôte : $liaisons"
else
	ok "aucune liaison hôte n'est attachée au conteneur : $liaisons"
fi

# --- 5. Santé publique, statut authentifié ------------------------------------------------------

titre "5. Santé sans jeton, statut avec jeton, refus indiscernables"

reponse=$(appel_interne GET /health/live "")
[ "$(code_de "$reponse")" = 200 ] \
	&& ok "GET /health/live répond 200 sans jeton" \
	|| fail "GET /health/live rend $(code_de "$reponse")"

reponse=$(appel_interne GET /health/ready "")
[ "$(code_de "$reponse")" = 200 ] \
	&& ok "GET /health/ready répond 200 sans jeton" \
	|| fail "GET /health/ready rend $(code_de "$reponse")"

reponse=$(appel_interne GET /internal/v1/status "Bearer $JETON")
code=$(code_de "$reponse")
corps=$(corps_de "$reponse")
if [ "$code" = 200 ]; then
	ok "GET /internal/v1/status répond 200 avec le jeton"
else
	fail "GET /internal/v1/status rend $code"
fi

[ "$(json_champ "$corps" service)" = mail-sync ] \
	&& ok "le statut se nomme mail-sync" || fail "champ « service » inattendu"
[ "$(json_champ "$corps" profile)" = dev ] \
	&& ok "le profil annoncé est dev" || fail "profil annoncé inattendu"
[ "$(json_champ "$corps" schema_version)" = 1 ] \
	&& ok "la version du schéma d'état est 1" || fail "version de schéma inattendue"

if printf '%s' "$corps" | grep -q '"imap":{"state":"waiting_for_configuration"}' \
	&& printf '%s' "$corps" | grep -q '"smtp":{"state":"waiting_for_configuration"}'; then
	ok "les deux workers sont explicitement en attente de configuration"
else
	fail "un worker prétend un état que l'unité ne livre pas : $corps"
fi

premier_refus=""
for entete in "" "Basic Zm9vOmJhcg==" "Bearer" "Bearer faux-jeton-0123456789abcdef0123" "Bearer $JETON suffixe"; do
	reponse=$(appel_interne GET /internal/v1/status "$entete")
	code=$(code_de "$reponse")
	corps=$(corps_de "$reponse")
	if [ "$code" != 401 ]; then
		fail "l'autorisation « ${entete:-<absente>} » rend $code au lieu de 401"
		continue
	fi
	if [ -z "$premier_refus" ]; then
		premier_refus=$corps
	elif [ "$corps" != "$premier_refus" ]; then
		fail "le refus de « ${entete:-<absente>} » se distingue des autres"
		continue
	fi
	ok "l'autorisation « ${entete:-<absente>} » rend un 401 indiscernable"
done

# --- 6. Routes de preuve absentes en production -------------------------------------------------

titre "6. Le checkpoint est 404 sous le profil prod"

CONTENEUR_PROD=p2enjoy-mail-sync-preuve-prod
docker rm -f "$CONTENEUR_PROD" >/dev/null 2>&1 || true
# LES DEUX VARIABLES DE `CRM-052` SONT OBLIGATOIRES, et ce conteneur les reçoit. Sans elles, le
# service refuse de démarrer — ce qui est le contrat voulu (docs/SPEC-mail-subsystem.md §13.5) —,
# et les trois contrôles de cette section échoueraient pour une raison qui ne les regarde pas.
# Le harnais de `CRM-051` a bien dénoncé le changement : c'est le mécanisme de la décision 51, et
# la révision se fait dans le même changement que la cause.
docker run -d --rm --name "$CONTENEUR_PROD" --network "$RESEAU" \
	-e P2ENJOY_ENV_PROFILE=prod \
	-e MAIL_SYNC_INTERNAL_TOKEN="$JETON" \
	-e MAIL_SYNC_STATE_PATH=/tmp/runtime.json \
	-e SUPABASE_URL=http://kong:8000 \
	-e SERVICE_ROLE_KEY="$(grep '^SERVICE_ROLE_KEY=' .env | cut -d= -f2-)" \
	--tmpfs /tmp \
	p2enjoy-crm-mail-sync:latest >/dev/null

appel_prod() {
	docker run --rm --network "$RESEAU" -e CHEMIN="$1" -e AUTORISATION="$2" -e HOTE="$CONTENEUR_PROD" \
		"$IMAGE_BASE" python -c '
import os, urllib.error, urllib.request
requete = urllib.request.Request("http://" + os.environ["HOTE"] + ":8080" + os.environ["CHEMIN"])
if os.environ["AUTORISATION"]:
    requete.add_header("Authorization", os.environ["AUTORISATION"])
try:
    with urllib.request.urlopen(requete, timeout=10) as reponse:
        print(reponse.status)
except urllib.error.HTTPError as erreur:
    print(erreur.code)
' 2>/dev/null
}

reste=30
while [ "$reste" -gt 0 ] && [ "$(appel_prod /health/live "")" != 200 ]; do sleep 1; reste=$((reste - 1)); done

[ "$(appel_prod /health/live "")" = 200 ] \
	&& ok "le conteneur de profil prod démarre depuis la même image" \
	|| fail "le conteneur de profil prod ne répond pas"

[ "$(appel_prod /internal/v1/status "Bearer $JETON")" = 200 ] \
	&& ok "le statut reste servi en production" || fail "le statut est perdu en production"

[ "$(appel_prod /internal/v1/dev/checkpoint "Bearer $JETON")" = 404 ] \
	&& ok "le checkpoint rend 404 en production, MÊME avec le bon jeton" \
	|| fail "le checkpoint reste atteignable en production"

docker rm -f "$CONTENEUR_PROD" >/dev/null 2>&1 || true

# --- 7. Arrêt et redémarrage sans perte ---------------------------------------------------------

titre "7. Arrêt puis redémarrage sans perte d'état"

TEMOIN=$(python3 -c 'import uuid; print(uuid.uuid4())')

reponse=$(appel_interne PUT /internal/v1/dev/checkpoint "Bearer $JETON" "{\"checkpoint\": \"$TEMOIN\"}")
[ "$(code_de "$reponse")" = 200 ] \
	&& ok "le checkpoint $TEMOIN est écrit par l'API interne" \
	|| fail "écriture du checkpoint refusée : $(code_de "$reponse")"

avant=$(corps_de "$(appel_interne GET /internal/v1/status "Bearer $JETON")")
compte_avant=$(json_champ "$avant" boot_count)
boot_avant=$(json_champ "$avant" boot_id)
info "avant : boot_count=$compte_avant boot_id=$boot_avant"

compose_dev stop "$SERVICE" >/dev/null 2>&1
compose_dev start "$SERVICE" >/dev/null 2>&1
attendre_sante || fail "le conteneur n'est pas redevenu sain après redémarrage"

apres=$(corps_de "$(appel_interne GET /internal/v1/status "Bearer $JETON")")
compte_apres=$(json_champ "$apres" boot_count)
boot_apres=$(json_champ "$apres" boot_id)
info "après : boot_count=$compte_apres boot_id=$boot_apres"

relu=$(corps_de "$(appel_interne GET /internal/v1/dev/checkpoint "Bearer $JETON")")
[ "$(json_champ "$relu" checkpoint)" = "$TEMOIN" ] \
	&& ok "le checkpoint survit à l'arrêt : $TEMOIN" \
	|| fail "checkpoint perdu ou modifié : $relu"

[ "$compte_apres" = "$((compte_avant + 1))" ] \
	&& ok "boot_count passe de $compte_avant à $compte_apres" \
	|| fail "boot_count attendu $((compte_avant + 1)), obtenu $compte_apres"

[ "$boot_avant" != "$boot_apres" ] \
	&& ok "boot_id est renouvelé" || fail "boot_id inchangé : le démarrage n'a pas eu lieu"

# --- 8. Journaux ---------------------------------------------------------------------------------

titre "8. Journaux JSON, sans secret ni avertissement"

journaux=$(docker logs "$CONTENEUR" 2>&1)

if printf '%s\n' "$journaux" | python3 -c '
import json, sys
for ligne in sys.stdin:
    ligne = ligne.strip()
    if not ligne:
        continue
    objet = json.loads(ligne)
    for clef in ("timestamp", "level", "service", "event"):
        if clef not in objet:
            raise SystemExit("champ manquant : " + clef)
' 2>/dev/null; then
	ok "chaque ligne de journal est un JSON complet"
else
	fail "au moins une ligne de journal n'est pas un JSON conforme"
fi

if printf '%s\n' "$journaux" | grep -qE '"level":"(WARNING|ERROR|CRITICAL)"'; then
	fail "le nominal produit une ligne WARNING ou pire"
	printf '%s\n' "$journaux" | grep -E '"level":"(WARNING|ERROR|CRITICAL)"' | head -5
else
	ok "aucune ligne WARNING, ERROR ou CRITICAL après démarrage, API, arrêt et reprise"
fi

if printf '%s\n' "$journaux" | grep -qF "$JETON"; then
	fail "le jeton interne apparaît dans les journaux"
else
	ok "le jeton interne n'apparaît dans aucun journal"
fi

if printf '%s\n' "$journaux" | grep -qiE 'authorization|"padding"|checkpoint":"[0-9a-f]{8}-'; then
	fail "un en-tête ou un corps de requête est journalisé"
else
	ok "ni en-tête d'authentification, ni corps de requête ne sont journalisés"
fi

for evenement in service_started request_completed; do
	printf '%s\n' "$journaux" | grep -q "\"event\":\"$evenement\"" \
		&& ok "l'événement $evenement est présent" \
		|| fail "l'événement $evenement est absent"
done

# --- 9. Traçabilité et secrets ------------------------------------------------------------------

titre "9. Traçabilité et absence de secret versionné"

for fichier in \
	mail-sync/Dockerfile mail-sync/requirements.txt \
	mail-sync/src/mail_sync/__init__.py mail-sync/src/mail_sync/__main__.py \
	mail-sync/src/mail_sync/app.py mail-sync/src/mail_sync/config.py \
	mail-sync/src/mail_sync/state.py mail-sync/src/mail_sync/structured_logging.py
do
	grep -q '@spec CRM-051' "$RACINE/$fichier" \
		&& ok "$fichier porte son @spec" || fail "$fichier n'a pas de @spec CRM-051"
done

# `pyproject.toml` et `requirements-dev.txt` ne servent que la preuve : ils citent donc
# l'unité en `@verifies`, comme les tests, et non en `@spec`.
for fichier in mail-sync/pyproject.toml mail-sync/requirements-dev.txt \
	mail-sync/tests/conftest.py mail-sync/tests/test_api.py \
	mail-sync/tests/test_config.py mail-sync/tests/test_main.py \
	mail-sync/tests/test_state.py mail-sync/tests/test_structured_logging.py
do
	grep -q '@verifies CRM-051' "$RACINE/$fichier" \
		&& ok "$fichier porte son @verifies" || fail "$fichier n'a pas de @verifies CRM-051"
done

if git -C "$RACINE" grep -qF "$JETON" -- . 2>/dev/null; then
	fail "le jeton interne est versionné dans le dépôt"
else
	ok "le jeton interne n'est versionné nulle part"
fi

for variable in MAIL_SYNC_INTERNAL_TOKEN MAIL_SYNC_LOG_LEVEL; do
	if grep -q "^$variable=" "$RACINE/.env.example" && grep -q "^$variable=" "$RACINE/.env"; then
		ok "$variable est documentée dans le gabarit et renseignée dans .env"
	else
		fail "$variable manque au gabarit ou à .env"
	fi
done

# --- 10. Contre-épreuve ---------------------------------------------------------------------------

if [ "$CONTRE_EPREUVE" = true ]; then
	titre "10. Contre-épreuve : les gardes doivent mordre"

	COPIE=$(mktemp -d)
	trap 'rm -rf "$COPIE"' EXIT

	printf '{tronqué' > "$COPIE/runtime.json"
	chmod 644 "$COPIE/runtime.json"
	if docker run --rm --network "$RESEAU" \
		-e P2ENJOY_ENV_PROFILE=dev -e MAIL_SYNC_INTERNAL_TOKEN="$JETON" \
		-e MAIL_SYNC_STATE_PATH=/etat/runtime.json \
		-v "$COPIE:/etat:z" p2enjoy-crm-mail-sync:latest >/dev/null 2>&1
	then
		fail "un état corrompu n'empêche pas le démarrage"
	else
		ok "un état corrompu fait échouer le démarrage"
	fi

	if [ "$(cat "$COPIE/runtime.json")" = '{tronqué' ]; then
		ok "l'état corrompu n'est pas effacé silencieusement"
	else
		fail "l'état corrompu a été réécrit"
	fi

	if docker run --rm \
		-e P2ENJOY_ENV_PROFILE=dev -e MAIL_SYNC_INTERNAL_TOKEN=trop-court \
		p2enjoy-crm-mail-sync:latest 2>&1 | grep -q 'trop-court'
	then
		fail "le refus de configuration cite la valeur fautive"
	else
		ok "le refus de configuration ne cite jamais la valeur fautive"
	fi

	rm -rf "$COPIE"
	trap - EXIT
fi

# --- Verdict --------------------------------------------------------------------------------------

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôle(s) verts.\033[0m\n' "$checks"
	exit 0
fi
printf '\033[31m%s contrôle(s) en échec sur %s.\033[0m\n' "$failures" "$checks"
exit 1
