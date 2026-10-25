#!/usr/bin/env bash
# @verifies CRM-115 (docs/BACKLOG.md) — tranche T3 : le registre des sessions et l'attribution d'un emplacement, hors pile
# @verifies CRM-115 tranche T4 — décision 713 : la base des ports prise au `.env` du checkout, l'adoption d'une pile de ce
#           checkout déjà en marche ou le refus — jamais une seconde pile —, l'écriture du `.env` d'un emplacement
#           (docs/SPEC-pile-par-session.md §3, §4.2 point 1 bis, §5)
# @verifies docs/SPEC-pile-par-session.md §3 (l'emplacement 0 reproduit l'existant, le pas de 100), §4.2 (attribution),
#           §4.3 (vérification à l'usage), §4.4 (entrée périmée), §4.5 (libération), §5 (les variables), §9 (preuves
#           attendues, hors la pile double qui revient à la T5) ; docs/JOURNAL.md décisions 705 et 710
#
# Les preuves de la T3 ne démarrent AUCUNE pile : chaque section travaille dans un registre jetable, sous un
# identifiant de démarrage et une horloge simulés, sur des ports de base relevés au-dessus de 47000 pour ne heurter
# aucune pile en marche. La règle mesurée est celle de `scripts/lib/emplacement.sh`, telle qu'appelée en production.
# Trois dégradations réelles du code prouvent que les sections mordent.
#
# Usage :
#   scripts/verify-emplacements.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0
checks=0
ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

TRAVAIL=$(mktemp -d)
ECOUTEURS=()
nettoyer() {
	local pid
	for pid in "${ECOUTEURS[@]}"; do kill "$pid" 2>/dev/null || true; done
	rm -rf "$TRAVAIL"
}
trap nettoyer EXIT

BIBLIOTHEQUE=scripts/lib/emplacement.sh
EMPREINTE=$(sha256sum "$BIBLIOTHEQUE" | cut -d' ' -f1)
MAINTENANT=2000000000

# Des ports de base hauts, libres de toute pile : 47000 à 47014 pour l'emplacement 0, + 100 par emplacement.
PORTS="$TRAVAIL/ports-base"
i=0
for variable in KONG_HTTP_PORT STUDIO_PORT POSTGRES_DIRECT_PORT MINIO_API_PORT MINIO_CONSOLE_PORT WEBAPP_DEV_PORT \
	WEBAPP_PREVIEW_PORT STALWART_SMTP_PORT STALWART_SUBMISSION_PORT STALWART_IMAP_PORT STALWART_ADMIN_PORT \
	ROUNDCUBE_PORT CLAMAV_PORT SSO_DEV_PORT MCP_DEV_PORT; do
	echo "$variable=$((47000 + i))" >>"$PORTS"
	i=$((i + 1))
done

# monde <nom> — un registre jetable et ses réglages ; rend le répertoire du monde.
monde() {
	local dir
	dir=$(mktemp -d "$TRAVAIL/$1.XXXX")
	mkdir -p "$dir/registre"
	echo "boot-a" >"$dir/boot_id"
	printf '%s\n' "$dir"
}

# lib <monde> <bibliothèque> <commande…> — exécute une fonction de la bibliothèque dans ce monde.
lib() {
	local dir=$1 bibliotheque=$2
	shift 2
	P2ENJOY_REGISTRE_SESSIONS="$dir/registre" P2ENJOY_BOOT_ID_FICHIER="$dir/boot_id" \
		P2ENJOY_HORLOGE="${HORLOGE:-$MAINTENANT}" P2ENJOY_PORTS_BASE_FICHIER="$PORTS" \
		P2ENJOY_ARRETER_PILE="${ARRETER:-true}" P2ENJOY_SESSION="${SESSION:-}" \
		P2ENJOY_PROJETS_DU_CHECKOUT="${PROJETS:-true}" \
		bash -c 'source "$1"; shift; "$@"' _ "$bibliotheque" "$@"
}

# ecouter <port> — occupe un port de bouclage le temps du harnais, comme une pile tierce le ferait.
ecouter() {
	python3 -I -c 'import socket, sys, time
s = socket.socket(); s.bind(("127.0.0.1", int(sys.argv[1]))); s.listen(); time.sleep(600)' "$1" &
	ECOUTEURS+=("$!")
	for _ in $(seq 1 50); do
		python3 -I -c 'import socket, sys
s = socket.socket()
try:
    s.bind(("127.0.0.1", int(sys.argv[1]))); sys.exit(1)
except OSError:
    sys.exit(0)' "$1" && return 0
		sleep 0.1
	done
	return 1
}

# Les sections, en fonctions : elles sont rejouées par les dégradations.
section_variables() {
	local lib=$1 env_base reference=1 variable valeur attendu
	# L'emplacement 0 rend les ports de `.env.example`, sans P2ENJOY_PORTS_BASE_FICHIER : le chemin de production.
	env_base=$(bash -c 'source "$1"; emplacement_variables 0' _ "$lib")
	while IFS='=' read -r variable valeur; do
		case "$variable" in *_PORT) ;; *) continue ;; esac
		attendu=$(sed -n "s/^$variable=//p" .env.example | tail -n 1)
		[ "$variable" = WEBAPP_PREVIEW_PORT ] && attendu=${attendu:-4173}
		[ "$valeur" = "$attendu" ] || { reference=0; echo "    $variable : $valeur au lieu de $attendu" >&2; }
	done <<<"$env_base"
	if [ "$reference" -eq 1 ] && [ "$(grep -c '_PORT=' <<<"$env_base")" -eq 15 ] \
		&& grep -qx 'COMPOSE_PROJECT_NAME=p2enjoy-crm' <<<"$env_base" && grep -qx 'P2ENJOY_TMP=/tmp/p2enjoy-crm/0' <<<"$env_base"; then
		ok "l'emplacement 0 reproduit l'existant : les quinze ports de .env.example, le projet p2enjoy-crm (§3, §11 point 4)"
	else
		fail "l'emplacement 0 ne reproduit pas l'existant"
	fi
	local trois
	trois=$(bash -c 'source "$1"; emplacement_variables 3' _ "$lib")
	if grep -qx 'KONG_HTTP_PORT=8300' <<<"$trois" && grep -qx 'POSTGRES_DIRECT_PORT=54622' <<<"$trois" \
		&& grep -qx 'COMPOSE_PROJECT_NAME=p2enjoy-crm-3' <<<"$trois" && grep -qx 'P2ENJOY_EMPLACEMENT=3' <<<"$trois"; then
		ok "l'emplacement 3 décale chaque port de 300 et nomme son projet p2enjoy-crm-3 (§3, §5, décision 710)"
	else
		fail "l'emplacement 3 ne porte pas ses variables"
	fi
}

section_attribution() {
	local lib=$1 m a b a2
	m=$(monde attribution)
	a=$(lib "$m" "$lib" emplacement_attribuer /checkouts/a)
	b=$(lib "$m" "$lib" emplacement_attribuer /checkouts/b)
	a2=$(lib "$m" "$lib" emplacement_attribuer /checkouts/a)
	if [ "$a" = 0 ] && [ "$b" = 1 ] && [ "$a2" = 0 ] && [ "$(ls "$m/registre" | grep -c '^emplacement-')" -eq 2 ]; then
		ok "attribution : le plus petit emplacement libre, et un checkout reprend le sien (§4.2, points 1 et 2)"
	else
		fail "attribution : a=$a b=$b a2=$a2"
	fi
}

section_concurrence() {
	local lib=$1 m k
	m=$(monde concurrence)
	for k in 1 2 3 4 5 6; do
		lib "$m" "$lib" emplacement_attribuer "/checkouts/c$k" >"$m/sortie-$k" &
	done
	wait
	if [ "$(cat "$m"/sortie-* | sort -u | wc -l)" -eq 6 ] && [ "$(ls "$m/registre" | grep -c '^emplacement-')" -eq 6 ]; then
		ok "six attributions simultanées reçoivent six emplacements distincts (§4.1, verrou ; §9)"
	else
		fail "attributions simultanées : $(cat "$m"/sortie-* | tr '\n' ' ')"
	fi
}

section_port_pris() {
	local lib=$1 m n
	m=$(monde port-pris)
	if ! ecouter 47002; then fail "port pris : l'écouteur de preuve n'a pas pu occuper 47002"; return; fi
	n=$(lib "$m" "$lib" emplacement_attribuer /checkouts/p 2>"$m/erreurs") || true
	# L'écouteur part avec la section : les suivantes retrouvent l'emplacement 0 libre.
	kill "${ECOUTEURS[-1]}" 2>/dev/null || true
	wait "${ECOUTEURS[-1]}" 2>/dev/null || true
	if [ "$n" = 1 ] && grep -q 'POSTGRES_DIRECT_PORT=47002' "$m/erreurs"; then
		ok "un port de l'emplacement pris par un tiers fait passer au suivant, et le motif le nomme (§4.2, point 3)"
	else
		fail "port pris : emplacement « $n », motif « $(cat "$m/erreurs") »"
	fi
}

section_meme_checkout() {
	local lib=$1 m code=0
	m=$(monde meme-checkout)
	SESSION=session-1 lib "$m" "$lib" emplacement_attribuer /checkouts/m >/dev/null
	SESSION=session-2 lib "$m" "$lib" emplacement_verifier /checkouts/m >/dev/null 2>"$m/erreurs" || code=$?
	if [ "$code" -eq 3 ] && grep -q 'session-1' "$m/erreurs" \
		&& SESSION=session-1 lib "$m" "$lib" emplacement_verifier /checkouts/m >/dev/null; then
		ok "deux sessions dans un même checkout : la seconde est refusée, la première passe (§4.3, §11 point 2)"
	else
		fail "même checkout : code $code, « $(cat "$m/erreurs") »"
	fi
}

section_vm_recyclee() {
	local lib=$1 m code=0 etat
	m=$(monde vm-recyclee)
	lib "$m" "$lib" emplacement_attribuer /checkouts/v >/dev/null || true
	echo "boot-b" >"$m/boot_id"
	lib "$m" "$lib" emplacement_verifier /checkouts/v >/dev/null 2>"$m/erreurs" || code=$?
	etat=$(lib "$m" "$lib" emplacement_lister | cut -f2)
	if [ "$code" -eq 4 ] && grep -q 'recyclée' "$m/erreurs" && [ "$etat" = vm-recyclee ]; then
		ok "une entrée d'un autre boot_id est reconnue « VM recyclée », et la mesure est refusée (§4.3, §8)"
	else
		fail "VM recyclée : code $code, état « $etat »"
	fi
	# Le lancement la recompose : l'attribution du même checkout rafraîchit `boot_id`, et la mesure repasse.
	if [ "$(lib "$m" "$lib" emplacement_attribuer /checkouts/v)" = 0 ] && lib "$m" "$lib" emplacement_verifier /checkouts/v >/dev/null; then
		ok "relancer le même checkout rafraîchit boot_id, et la mesure repasse (§4.3)"
	else
		fail "VM recyclée : le relancement ne rafraîchit pas l'entrée"
	fi
}

section_peremption() {
	local lib=$1 m n
	m=$(monde peremption)
	HORLOGE=$((MAINTENANT - 21601)) lib "$m" "$lib" emplacement_attribuer /checkouts/ancien >/dev/null
	cat >"$m/arreter" <<EOF
#!/usr/bin/env bash
echo "\$*" >>"$m/arrets"
EOF
	chmod +x "$m/arreter"
	n=$(ARRETER="$m/arreter" lib "$m" "$lib" emplacement_attribuer /checkouts/nouveau)
	if [ "$n" = 0 ] && [ "$(cat "$m/arrets" 2>/dev/null)" = p2enjoy-crm ] && grep -q '/checkouts/ancien' "$m/registre/reprises.log" \
		&& [ "$(lib "$m" "$lib" emplacement_champ "$m/registre/emplacement-0" checkout)" = /checkouts/nouveau ]; then
		ok "une entrée inactive depuis plus de 6 h est reprise : sa pile arrêtée par son projet, sans -v, la reprise consignée (§4.4)"
	else
		fail "péremption : emplacement « $n », arrêt « $(cat "$m/arrets" 2>/dev/null) »"
	fi
	# Six heures pile ne périment pas : la borne est stricte.
	m=$(monde peremption-borne)
	HORLOGE=$((MAINTENANT - 21600)) lib "$m" "$lib" emplacement_attribuer /checkouts/ancien >/dev/null
	[ "$(lib "$m" "$lib" emplacement_attribuer /checkouts/nouveau)" = 1 ] \
		&& ok "une entrée inactive depuis exactement 6 h reste due à sa session (§4.4, §11 point 3)" \
		|| fail "péremption : six heures pile périment l'entrée"
}

section_plein() {
	local lib=$1 m code=0
	m=$(monde plein)
	P2ENJOY_EMPLACEMENTS_MAX=2 lib "$m" "$lib" emplacement_attribuer /checkouts/x >/dev/null || true
	P2ENJOY_EMPLACEMENTS_MAX=2 lib "$m" "$lib" emplacement_attribuer /checkouts/y >/dev/null || true
	P2ENJOY_EMPLACEMENTS_MAX=2 lib "$m" "$lib" emplacement_attribuer /checkouts/z >/dev/null 2>"$m/erreurs" || code=$?
	if [ "$code" -ne 0 ] && grep -q '/checkouts/x' "$m/erreurs" && [ "$(ls "$m/registre" | grep -c '^emplacement-')" -eq 2 ]; then
		ok "sans emplacement libre, l'attribution échoue sans rien écrire et liste les sessions en cours (§4.2)"
	else
		fail "plein : code $code"
	fi
}

section_liberation_et_env() {
	local lib=$1 m code=0
	m=$(monde liberation)
	lib "$m" "$lib" emplacement_attribuer /checkouts/l >/dev/null
	lib "$m" "$lib" emplacement_liberer 0 >/dev/null 2>&1 || code=$?
	if [ "$code" -eq 3 ] && [ -f "$m/registre/emplacement-0" ]; then
		ok "libérer à la main un emplacement vivant est refusé (§4.5)"
	else
		fail "libération d'un emplacement vivant : code $code"
	fi
	HORLOGE=$((MAINTENANT + 30000)) lib "$m" "$lib" emplacement_liberer 0 >/dev/null 2>&1 \
		&& [ ! -f "$m/registre/emplacement-0" ] \
		&& ok "un emplacement périmé se libère à la main (§4.5)" \
		|| fail "un emplacement périmé ne se libère pas"
	m=$(monde env)
	lib "$m" "$lib" emplacement_attribuer /checkouts/e >/dev/null
	echo "P2ENJOY_EMPLACEMENT=4" >"$m/.env"
	code=0
	lib "$m" "$lib" emplacement_verifier /checkouts/e "$m/.env" >/dev/null 2>&1 || code=$?
	[ "$code" -eq 5 ] && ok "un .env qui déclare un autre emplacement que le registre est refusé (§4.3)" \
		|| fail "un .env divergent passe : code $code"
}


section_base_env() {
	local lib=$1 m env vars
	m=$(monde base-env)
	env="$m/.env"
	printf 'KONG_HTTP_PORT=8123\nWEBAPP_DEV_PORT=5273\nAPI_EXTERNAL_URL=http://localhost:8123\nSITE_URL=http://127.0.0.1:5273\nSECRET_GARDE=ne-change-pas\n' >"$env"
	vars=$(bash -c 'source "$1"; emplacement_variables 0 "$2"' _ "$lib" "$env")
	if grep -qx 'KONG_HTTP_PORT=8123' <<<"$vars" && grep -qx 'WEBAPP_DEV_PORT=5273' <<<"$vars" && grep -qx 'MINIO_API_PORT=9000' <<<"$vars"; then
		ok "l'emplacement 0 d'un .env aux ports changés garde ses ports ; un port absent prend la valeur de .env.example (§3, décision 713)"
	else
		fail "base du .env : $(tr '\n' ' ' <<<"$vars")"
	fi
	bash -c 'source "$1"; emplacement_ecrire_env 2 "$2"' _ "$lib" "$env"
	if grep -qx 'KONG_HTTP_PORT=8323' "$env" && grep -qx 'API_EXTERNAL_URL=http://localhost:8323' "$env" \
		&& grep -qx 'SITE_URL=http://127.0.0.1:5473' "$env" && grep -qx 'P2ENJOY_EMPLACEMENT=2' "$env" \
		&& grep -qx 'COMPOSE_PROJECT_NAME=p2enjoy-crm-2' "$env" && grep -qx 'SECRET_GARDE=ne-change-pas' "$env"; then
		ok "écrire l'emplacement 2 décale ports et URL de 200, pose le projet, et ne touche pas aux autres variables (§5)"
	else
		fail "écriture du .env de l'emplacement 2"
	fi
	# Le .env déclare désormais l'emplacement 2 : sa base reste celle d'origine, et le retour à 0 rend les ports d'avant.
	bash -c 'source "$1"; emplacement_ecrire_env 0 "$2"' _ "$lib" "$env"
	grep -qx 'KONG_HTTP_PORT=8123' "$env" && grep -qx 'SITE_URL=http://127.0.0.1:5273' "$env" \
		&& ok "revenir à l'emplacement 0 rend exactement les ports d'origine : la base se déduit de l'emplacement déclaré (décision 713)" \
		|| fail "le retour à l'emplacement 0 ne rend pas les ports d'origine"
}

section_adoption() {
	local lib=$1 m n code=0
	m=$(monde adoption)
	echo 'echo p2enjoy-crm' >"$m/projets"; chmod +x "$m/projets"
	if ! ecouter 47000; then fail "adoption : l'écouteur de preuve n'a pas pu occuper 47000"; return; fi
	n=$(PROJETS="bash $m/projets" lib "$m" "$lib" emplacement_attribuer /checkouts/vivant 2>"$m/erreurs") || true
	kill "${ECOUTEURS[-1]}" 2>/dev/null || true; wait "${ECOUTEURS[-1]}" 2>/dev/null || true
	if [ "$n" = 0 ] && [ -f "$m/registre/emplacement-0" ]; then
		ok "une pile de ce checkout qui tourne sous p2enjoy-crm est ADOPTÉE à l'emplacement 0, ses propres ports ne comptant pas (§4.2 point 1 bis)"
	else
		fail "adoption : emplacement « $n », « $(cat "$m/erreurs") »"
	fi
	m=$(monde adoption-refus)
	echo 'echo projet-inconnu' >"$m/projets"
	PROJETS="bash $m/projets" lib "$m" "$lib" emplacement_attribuer /checkouts/x >/dev/null 2>"$m/erreurs" || code=$?
	if [ "$code" -ne 0 ] && grep -q 'projet-inconnu' "$m/erreurs" && [ -z "$(ls "$m/registre" | grep '^emplacement-')" ]; then
		ok "une pile de ce checkout sous un projet qui ne désigne aucun emplacement : refus, rien d'écrit — jamais une seconde pile (décision 713)"
	else
		fail "adoption d'un projet inconnu : code $code"
	fi
	m=$(monde adoption-deux)
	printf 'echo p2enjoy-crm\necho p2enjoy-crm-2\n' >"$m/projets"
	code=0
	PROJETS="bash $m/projets" lib "$m" "$lib" emplacement_attribuer /checkouts/x >/dev/null 2>&1 || code=$?
	[ "$code" -ne 0 ] && ok "deux piles du même checkout en marche : refus" || fail "deux piles du même checkout : acceptées"
	m=$(monde adoption-prise)
	lib "$m" "$lib" emplacement_attribuer /checkouts/autre >/dev/null || true
	echo 'echo p2enjoy-crm' >"$m/projets"
	code=0
	PROJETS="bash $m/projets" lib "$m" "$lib" emplacement_attribuer /checkouts/x >/dev/null 2>"$m/erreurs" || code=$?
	[ "$code" -ne 0 ] && grep -q '/checkouts/autre' "$m/erreurs" \
		&& ok "le projet de la pile désigne un emplacement inscrit pour un autre checkout : refus, qui le nomme" \
		|| fail "adoption d'un emplacement tenu par un autre checkout : code $code"
}

titre "1. Les variables d'un emplacement"
section_variables "$BIBLIOTHEQUE"
section_base_env "$BIBLIOTHEQUE"
titre "2. Attribution, concurrence, ports"
section_attribution "$BIBLIOTHEQUE"
section_concurrence "$BIBLIOTHEQUE"
section_port_pris "$BIBLIOTHEQUE"
section_plein "$BIBLIOTHEQUE"
section_adoption "$BIBLIOTHEQUE"
titre "3. Vérification à l'usage, VM recyclée, péremption, libération"
section_meme_checkout "$BIBLIOTHEQUE"
section_vm_recyclee "$BIBLIOTHEQUE"
section_peremption "$BIBLIOTHEQUE"
section_liberation_et_env "$BIBLIOTHEQUE"
titre "4. scripts/sessions.sh"
m=$(monde sessions)
lib "$m" "$BIBLIOTHEQUE" emplacement_attribuer /checkouts/s >/dev/null
sortie=$(P2ENJOY_REGISTRE_SESSIONS="$m/registre" P2ENJOY_BOOT_ID_FICHIER="$m/boot_id" P2ENJOY_HORLOGE=$MAINTENANT scripts/sessions.sh liste)
grep -qP '^0\tvivante\t.*\tp2enjoy-crm\t/checkouts/s$' <<<"$sortie" \
	&& ok "sessions.sh liste rend l'emplacement, son état mesuré, son projet et son checkout (§4.5)" \
	|| fail "sessions.sh liste : « $sortie »"

titre "5. La détection réelle, contre le démon Docker du poste"
# Les sections précédentes simulent Docker. Celle-ci l'interroge : c'est le chemin que l'incident de la décision 713 a
# emprunté sans qu'aucune preuve ne l'ait parcouru.
if command -v docker >/dev/null 2>&1 && attendus=$(docker ps --filter "label=com.docker.compose.project.working_dir=$PWD" \
	--format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | sort -u) && [ -n "$attendus" ]; then
	trouves=$(bash -c 'source "$1"; emplacement_projets_du_checkout "$PWD"' _ "$BIBLIOTHEQUE")
	[ "$trouves" = "$attendus" ] \
		&& ok "la pile de ce checkout est reconnue sous son projet réel ($(tr '\n' ' ' <<<"$trouves")) (§4.2 point 1 bis)" \
		|| fail "la détection réelle rend « $trouves » au lieu de « $attendus »"
	m=$(monde reel)
	n=$(P2ENJOY_REGISTRE_SESSIONS="$m/registre" bash -c 'source "$1"; emplacement_attribuer "$PWD" "${P2ENJOY_ENV_FILE:-.env}"' _ "$BIBLIOTHEQUE" 2>"$m/erreurs") || true
	attendu_n=$(bash -c 'source "$1"; emplacement_de_projet "$2"' _ "$BIBLIOTHEQUE" "$(head -n 1 <<<"$attendus")") || attendu_n=refus
	[ "$n" = "$attendu_n" ] \
		&& ok "attribution à blanc dans un registre jetable : la pile en marche est adoptée à l'emplacement $n, aucune seconde pile" \
		|| fail "attribution à blanc : emplacement « $n » au lieu de « $attendu_n » — $(cat "$m/erreurs")"
else
	echo "  (aucune pile de ce checkout en marche : section sans objet sur ce poste)"
fi

titre "6. Dégradations réelles, puis restauration constatée"
# degrader <nom> <avant> <après> <section> — une copie mutée de la bibliothèque doit faire rougir la section.
degrader() {
	local nom=$1 avant=$2 apres=$3 section=$4 copie="$TRAVAIL/mutant-$1.sh" sortie
	python3 -I - "$BIBLIOTHEQUE" "$copie" "$avant" "$apres" <<'PY'
import sys
source, cible, avant, apres = sys.argv[1:]
texte = open(source, encoding='utf-8').read()
if texte.count(avant) != 1:
    sys.exit(f"motif introuvable : {avant!r}")
open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres))
PY
	sortie=$(failures=0; "$section" "$copie" 2>&1; echo "ECHECS=$failures")
	if grep -q 'ECHECS=[1-9]' <<<"$sortie"; then
		ok "dégradation « $nom » : la section la dénonce"
	else
		fail "dégradation « $nom » : la section reste verte — elle ne mord pas"
	fi
}
degrader "boot_id ignoré" \
	'if [ "$(emplacement_champ "$fichier" boot_id)" != "$(emplacement_boot_id)" ]; then
		echo "refus : la VM' \
	'if false; then
		echo "refus : la VM' section_vm_recyclee
degrader "péremption à 7 h" 'EMPLACEMENT_PEREMPTION_S=21600' 'EMPLACEMENT_PEREMPTION_S=25200' section_peremption
degrader "adoption retirée" '	projets=$(emplacement_projets_du_checkout "$checkout" | sort -u)' '	projets=""' section_adoption
degrader "ports non mesurés" 'if ! emplacement_port_libre "$port"; then' 'if false; then' section_port_pris
# Restauration : la bibliothèque du dépôt est intacte, et les sections la trouvent conforme.
[ "$(sha256sum "$BIBLIOTHEQUE" | cut -d' ' -f1)" = "$EMPREINTE" ] \
	&& ok "restauration : les dégradations n'ont porté que sur des copies, la bibliothèque du dépôt n'est pas touchée" \
	|| fail "la bibliothèque du dépôt a changé pendant le harnais"

titre "Résultat"
if [ "$failures" -eq 0 ]; then
	printf '  \033[32m%d contrôles, aucune anomalie.\033[0m\n\n' "$checks"
else
	printf '  \033[31m%d contrôles, %d en échec.\033[0m\n\n' "$checks" "$failures"
	exit 1
fi
