#!/usr/bin/env bash
# @spec CRM-115 (docs/BACKLOG.md) — tranche T3 : le registre des sessions et l'attribution d'un emplacement
# @spec docs/SPEC-pile-par-session.md §3 (un emplacement par checkout, le pas de 100), §4.1 (forme du registre, verrou),
#       §4.2 (attribution), §4.3 (vérification à l'usage), §4.4 (entrée périmée), §4.5 (libération), §5 (les variables
#       d'un emplacement, dont ce fichier est la SEULE source) ; docs/JOURNAL.md décisions 705 (§11 validé) et 710 (les
#       quinze ports)
#
# Une PILE de développement est désignée par un EMPLACEMENT, un entier de 0 à P2ENJOY_EMPLACEMENTS_MAX - 1. Le
# registre, hors de tout checkout, répertorie les emplacements occupés : un fichier `emplacement-N` par emplacement, en
# lignes `clé=valeur`. Toute lecture-écriture se fait sous `flock` sur `registre.lock` : deux lancements simultanés se
# suivent et ne reçoivent jamais le même emplacement.
#
# Elle n'exécute rien à l'inclusion. Tout ce qui varie d'un poste à l'autre ou d'une preuve à l'autre est une variable,
# lue à l'appel :
#   P2ENJOY_REGISTRE_SESSIONS   répertoire du registre, `/var/tmp/p2enjoy-crm/sessions` par défaut (§11, point 1)
#   P2ENJOY_EMPLACEMENTS_MAX    nombre d'emplacements, 10 par défaut — le pas de 100 n'est sûr que jusque-là (§3)
#   P2ENJOY_SESSION             identifiant de la session ; à défaut, celui de l'entrée existante ou l'heure du lancement
#   P2ENJOY_BOOT_ID_FICHIER     `/proc/sys/kernel/random/boot_id` par défaut : change à chaque recyclage de la VM
#   P2ENJOY_HORLOGE             secondes depuis l'époque, pour les preuves ; l'horloge réelle à défaut
#   P2ENJOY_PORTS_BASE_FICHIER  lignes `VARIABLE=port` remplaçant les ports de base, pour les preuves
#   P2ENJOY_ARRETER_PILE        commande qui arrête une pile périmée, recevant le nom de projet ; à défaut
#                               `docker compose -p <projet> down` — VOLUMES CONSERVÉS (§4.4)

#: La péremption d'une entrée : six heures d'inactivité, la borne d'une prise du backlog (§4.4, §11 point 3).
EMPLACEMENT_PEREMPTION_S=21600

#: Les quinze ports d'un emplacement à leur valeur de base, celle de `.env.example` — l'emplacement 0 reproduit
#: l'existant (§3, §11 point 4). Quatorze sont publiés par `docker-compose.dev.yml` ; `WEBAPP_PREVIEW_PORT` est celui de
#: la prévisualisation des preuves. `POSTGRES_DIRECT_PORT` est la correction de la décision 710.
EMPLACEMENT_PORTS_BASE=(
	KONG_HTTP_PORT=8000
	STUDIO_PORT=54323
	POSTGRES_DIRECT_PORT=54322
	MINIO_API_PORT=9000
	MINIO_CONSOLE_PORT=9001
	WEBAPP_DEV_PORT=5173
	WEBAPP_PREVIEW_PORT=4173
	STALWART_SMTP_PORT=1025
	STALWART_SUBMISSION_PORT=1587
	STALWART_IMAP_PORT=1143
	STALWART_ADMIN_PORT=8081
	ROUNDCUBE_PORT=8080
	CLAMAV_PORT=3310
	SSO_DEV_PORT=18480
	MCP_DEV_PORT=18490
)

emplacement_registre() { printf '%s\n' "${P2ENJOY_REGISTRE_SESSIONS:-/var/tmp/p2enjoy-crm/sessions}"; }
emplacement_max() { printf '%s\n' "${P2ENJOY_EMPLACEMENTS_MAX:-10}"; }
emplacement_maintenant() { printf '%s\n' "${P2ENJOY_HORLOGE:-$(date -u +%s)}"; }
emplacement_boot_id() { tr -d '[:space:]' <"${P2ENJOY_BOOT_ID_FICHIER:-/proc/sys/kernel/random/boot_id}"; }

#: Le nom de projet Compose d'un emplacement : `p2enjoy-crm` pour 0, `p2enjoy-crm-N` au-delà (§3).
emplacement_projet() { if [ "$1" -eq 0 ]; then echo p2enjoy-crm; else echo "p2enjoy-crm-$1"; fi; }

# emplacement_ports_base — les lignes `VARIABLE=port` de base, ou celles de P2ENJOY_PORTS_BASE_FICHIER.
emplacement_ports_base() {
	if [ -n "${P2ENJOY_PORTS_BASE_FICHIER:-}" ]; then
		grep -E '^[A-Z_]+=[0-9]+$' "$P2ENJOY_PORTS_BASE_FICHIER"
	else
		printf '%s\n' "${EMPLACEMENT_PORTS_BASE[@]}"
	fi
}

# emplacement_variables <N> — les variables de l'emplacement, une par ligne `VARIABLE=valeur` : les quinze ports à leur
# base + 100 × N, puis le nom de projet, le répertoire de travail des harnais et l'emplacement lui-même (§5). Les URL
# qui répètent les ports sont réécrites par l'écriture du `.env` (tranche T4), à partir de ces valeurs.
emplacement_variables() {
	local n=$1 ligne
	while IFS= read -r ligne; do
		printf '%s=%s\n' "${ligne%%=*}" "$(( ${ligne#*=} + 100 * n ))"
	done < <(emplacement_ports_base)
	printf 'COMPOSE_PROJECT_NAME=%s\nP2ENJOY_TMP=/tmp/p2enjoy-crm/%s\nP2ENJOY_EMPLACEMENT=%s\n' "$(emplacement_projet "$n")" "$n" "$n"
}

# emplacement_port_libre <port> — vrai si une liaison réussit sur l'interface de bouclage. Le poste n'a ni `ss` ni
# `netstat` (INC-044) : la tentative de liaison est la mesure, et la seule qui dise ce que Docker trouvera.
emplacement_port_libre() {
	python3 -I -c 'import socket, sys
s = socket.socket()
try:
    s.bind(("127.0.0.1", int(sys.argv[1])))
except OSError:
    sys.exit(1)
finally:
    s.close()' "$1"
}

# emplacement_champ <fichier> <clé> — la valeur d'une clé d'une entrée.
emplacement_champ() { sed -n "s/^$2=//p" "$1" | tail -n 1; }

# emplacement_etat <fichier> — l'état mesuré d'une entrée : `perimee` (plus de six heures sans usage), `vm-recyclee`
# (autre identifiant de démarrage : la pile est arrêtée ou à moitié vivante, §8), ou `vivante`. La péremption prime : un
# `boot_id` différent ne suffit pas à périmer une entrée (§4.4).
emplacement_etat() {
	local fichier=$1 activite
	activite=$(emplacement_champ "$fichier" activite)
	if [ $(( $(emplacement_maintenant) - ${activite:-0} )) -gt "$EMPLACEMENT_PEREMPTION_S" ]; then
		echo perimee
	elif [ "$(emplacement_champ "$fichier" boot_id)" != "$(emplacement_boot_id)" ]; then
		echo vm-recyclee
	else
		echo vivante
	fi
}

# emplacement_entree_du_checkout <checkout> — le fichier de l'entrée qui porte ce checkout, ou rien.
emplacement_entree_du_checkout() {
	local fichier
	for fichier in "$(emplacement_registre)"/emplacement-*; do
		[ -f "$fichier" ] || continue
		[ "$(emplacement_champ "$fichier" checkout)" = "$1" ] && { printf '%s\n' "$fichier"; return 0; }
	done
	return 1
}

# emplacement_ecrire <fichier> <N> <session> <checkout> <ouvert> — écrit l'entrée d'un trait, par un fichier temporaire
# renommé : une lecture concurrente hors verrou ne voit jamais une entrée à moitié écrite.
emplacement_ecrire() {
	local fichier=$1 n=$2 session=$3 checkout=$4 ouvert=$5 maintenant
	maintenant=$(emplacement_maintenant)
	printf 'emplacement=%s\nsession=%s\ncheckout=%s\nprojet=%s\nboot_id=%s\nouvert=%s\nactivite=%s\n' \
		"$n" "$session" "$checkout" "$(emplacement_projet "$n")" "$(emplacement_boot_id)" "$ouvert" "$maintenant" \
		>"$fichier.tmp"
	mv "$fichier.tmp" "$fichier"
}

# emplacement_sous_verrou <commande…> — exécute la commande sous le verrou exclusif du registre.
emplacement_sous_verrou() {
	local registre
	registre=$(emplacement_registre)
	mkdir -p "$registre"
	(
		flock -x 9
		"$@"
	) 9>"$registre/registre.lock"
}

# emplacement_attribuer <checkout> — rend l'emplacement de ce checkout sur la sortie standard, en l'attribuant s'il le
# faut (§4.2), sous verrou. Échoue sans rien écrire si aucun emplacement n'est libre, en listant les sessions.
emplacement_attribuer() { emplacement_sous_verrou _emplacement_attribuer "$@"; }

_emplacement_attribuer() {
	local checkout=$1 registre max n fichier variable port occupe session existante
	registre=$(emplacement_registre)
	max=$(emplacement_max)
	session=${P2ENJOY_SESSION:-}

	# 1. Ce checkout a déjà son emplacement : il le reprend, et rafraîchit son entrée — `boot_id` compris, puisque c'est
	#    le lancement qui recompose une pile revenue à moitié après un recyclage (§4.3, §8).
	if existante=$(emplacement_entree_du_checkout "$checkout"); then
		n=$(emplacement_champ "$existante" emplacement)
		emplacement_ecrire "$existante" "$n" "${session:-$(emplacement_champ "$existante" session)}" "$checkout" \
			"$(emplacement_champ "$existante" ouvert)"
		printf '%s\n' "$n"
		return 0
	fi

	# 2. Le plus petit emplacement sans entrée, ou dont l'entrée est périmée ; 3. dont chaque port est libre.
	for (( n = 0; n < max; n++ )); do
		fichier="$registre/emplacement-$n"
		if [ -f "$fichier" ]; then
			[ "$(emplacement_etat "$fichier")" = perimee ] || continue
		fi
		occupe=""
		while IFS='=' read -r variable port; do
			case "$variable" in *_PORT) ;; *) continue ;; esac
			if ! emplacement_port_libre "$port"; then occupe="$variable=$port"; break; fi
		done < <(emplacement_variables "$n")
		if [ -n "$occupe" ]; then
			echo "emplacement $n écarté : le port $occupe est déjà pris sur 127.0.0.1." >&2
			continue
		fi
		if [ -f "$fichier" ]; then
			_emplacement_reprendre "$fichier"
		fi
		# 4. L'entrée est écrite ; les variables de l'emplacement le seront dans `.env` par le lancement (tranche T4).
		emplacement_ecrire "$fichier" "$n" "${session:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}" "$checkout" "$(emplacement_maintenant)"
		printf '%s\n' "$n"
		return 0
	done

	echo "aucun emplacement libre sur $max — sessions en cours :" >&2
	_emplacement_lister >&2
	return 1
}

# _emplacement_reprendre <fichier> — reprend une entrée périmée (§4.4) : sa pile est arrêtée, ses volumes conservés,
# rien n'est effacé de son checkout, et la reprise est consignée dans `reprises.log`.
_emplacement_reprendre() {
	local fichier=$1 projet
	projet=$(emplacement_champ "$fichier" projet)
	if [ -n "${P2ENJOY_ARRETER_PILE:-}" ]; then
		$P2ENJOY_ARRETER_PILE "$projet"
	else
		docker compose -p "$projet" down >/dev/null 2>&1 || true
	fi
	printf '%s reprise de l emplacement %s (projet %s, session %s, checkout %s, dernière activité %s)\n' \
		"$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(emplacement_champ "$fichier" emplacement)" "$projet" \
		"$(emplacement_champ "$fichier" session)" "$(emplacement_champ "$fichier" checkout)" \
		"$(emplacement_champ "$fichier" activite)" >>"$(emplacement_registre)/reprises.log"
	rm -f "$fichier"
}

# emplacement_verifier <checkout> [<fichier .env>] — la vérification à l'usage (§4.3) : rend l'emplacement et rafraîchit
# l'activité, ou refuse en nommant la cause. Une pile dont la VM a été recyclée n'est pas mesurée : le refus renvoie à
# `./runDev.sh`, qui la recompose.
emplacement_verifier() { emplacement_sous_verrou _emplacement_verifier "$@"; }

_emplacement_verifier() {
	local checkout=$1 env_fichier=${2:-} fichier n session_entree activite declare
	if ! fichier=$(emplacement_entree_du_checkout "$checkout"); then
		echo "aucun emplacement pour ce checkout ($checkout) : lancez ./runDev.sh." >&2
		return 1
	fi
	n=$(emplacement_champ "$fichier" emplacement)
	session_entree=$(emplacement_champ "$fichier" session)
	activite=$(emplacement_champ "$fichier" activite)
	if [ -n "${P2ENJOY_SESSION:-}" ] && [ "$session_entree" != "$P2ENJOY_SESSION" ] \
		&& [ $(( $(emplacement_maintenant) - ${activite:-0} )) -le "$EMPLACEMENT_PEREMPTION_S" ]; then
		echo "refus : la session « $session_entree » travaille dans ce checkout (activité il y a moins de 6 h) ; un checkout ne porte qu'une pile (§11, point 2)." >&2
		return 3
	fi
	if [ "$(emplacement_champ "$fichier" boot_id)" != "$(emplacement_boot_id)" ]; then
		echo "refus : la VM a été recyclée depuis le lancement de l'emplacement $n — sa pile est arrêtée ou à moitié vivante ; relancez ./runDev.sh avant de mesurer." >&2
		return 4
	fi
	if [ -n "$env_fichier" ] && [ -f "$env_fichier" ]; then
		declare=$(sed -n 's/^P2ENJOY_EMPLACEMENT=//p' "$env_fichier" | tail -n 1)
		if [ -n "$declare" ] && [ "$declare" != "$n" ]; then
			echo "refus : $env_fichier déclare l'emplacement $declare, le registre attribue $n à ce checkout — le fichier a été changé hors du registre." >&2
			return 5
		fi
	fi
	emplacement_ecrire "$fichier" "$n" "${P2ENJOY_SESSION:-$session_entree}" "$checkout" "$(emplacement_champ "$fichier" ouvert)"
	printf '%s\n' "$n"
}

# emplacement_liberer <N> — retire l'entrée d'un emplacement (§4.5). L'arrêt de la pile est l'affaire de l'appelant
# (`./runDev.sh --stop`) ; libérer à la main un emplacement VIVANT est refusé, sauf `--force`.
emplacement_liberer() { emplacement_sous_verrou _emplacement_liberer "$@"; }

_emplacement_liberer() {
	local n=$1 force=${2:-} fichier
	fichier="$(emplacement_registre)/emplacement-$n"
	if [ ! -f "$fichier" ]; then
		echo "l'emplacement $n n'a aucune entrée." >&2
		return 1
	fi
	if [ "$force" != --force ] && [ "$(emplacement_etat "$fichier")" = vivante ]; then
		echo "refus : l'emplacement $n est vivant (session $(emplacement_champ "$fichier" session)) ; seul un emplacement périmé ou d'une VM recyclée se libère à la main." >&2
		return 3
	fi
	rm -f "$fichier"
}

# emplacement_lister — le registre, une ligne par entrée, avec son état mesuré (§4.5).
emplacement_lister() { emplacement_sous_verrou _emplacement_lister; }

_emplacement_lister() {
	local fichier trouve=""
	for fichier in "$(emplacement_registre)"/emplacement-*; do
		[ -f "$fichier" ] || continue
		trouve=1
		printf '%s\t%s\t%s\t%s\t%s\n' "$(emplacement_champ "$fichier" emplacement)" "$(emplacement_etat "$fichier")" \
			"$(emplacement_champ "$fichier" session)" "$(emplacement_champ "$fichier" projet)" \
			"$(emplacement_champ "$fichier" checkout)"
	done
	[ -n "$trouve" ] || echo "(aucune session enregistrée)"
}
