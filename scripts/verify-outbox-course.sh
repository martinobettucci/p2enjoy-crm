#!/usr/bin/env bash
# @verifies CRM-144 (docs/BACKLOG.md) — tranche T2 : la course entre l'annulation et la passe d'envoi, à deux connexions
#           réelles — une annulation ne laisse jamais partir un message, et ne dit jamais « annulé » d'un message parti
# @verifies docs/SPEC-mail-subsystem.md §28.3 et §28.5 (les deux ordres du verrou) ; docs/SCHEMA.md « Migration `0176` »
#
# POURQUOI UN SCRIPT, ET PAS pgTAP. Une suite pgTAP tient une seule connexion : elle ne peut pas faire attendre une
# transaction derrière le verrou d'une autre. `dblink` le permettrait, mais le rôle `postgres` de Supabase n'est pas
# superutilisateur, et `dblink` exige alors un mot de passe qu'aucune preuve versionnée ne porte (`CLAUDE.md` §3,
# docs/SPEC-mail-subsystem.md §28.5). Ce script ouvre donc DEUX VRAIES SESSIONS `psql` dans le conteneur de la base
# locale (par le socket, sans secret), et les pilote pas à pas ; une troisième, ponctuelle, constate l'attente.
#
# LES DEUX ORDRES, ET CE QUI EST EXIGÉ :
#   1. L'ANNULATION VERROUILLE D'ABORD. La session A annule sous la session de l'autrice, sans valider : elle tient le
#      verrou de la ligne. La session B joue `reserver_envois` : elle ne réserve PAS l'envoi (la ligne est verrouillée,
#      `skip locked`). A valide ; B rejoue : elle ne le réserve toujours pas (la ligne relue est `cancelled`). L'envoi est
#      `cancelled`, jamais `sending`, et le fil porte UNE ligne `mail_cancelled`.
#   2. LA PASSE VERROUILLE D'ABORD. B réserve l'envoi sans valider : elle tient le verrou. A annule : la troisième
#      session constate qu'A ATTEND un verrou. B valide ; A, débloquée, refuse `outbox_sending`. L'envoi est `sending`,
#      et le fil ne porte AUCUNE ligne `mail_cancelled`.
#
# LE WORKER LOCAL. `mail-sync` joue lui aussi `reserver_envois`, chaque minute. L'envoi de la preuve ne naît donc dû
# qu'au tout dernier moment, et le plus ancien (`created_at` en 2000) pour que `reserver_envois(1)` le choisisse avant
# toute ligne du seed. Si le worker le prend entre-temps, le script le DIT (« le worker a pris l'envoi ») et rejoue
# l'ordre, au plus trois fois — jamais il ne l'interprète comme un succès. Les passes de l'ordre 1 sont annulées
# (`rollback`) : elles ne réservent rien pour de bon, pas même une ligne du seed.
#
# Rien ne reste : chaque ligne créée (l'envoi, son événement) est retirée, en fin d'ordre comme en cas d'échec.
#
# Usage :
#   scripts/verify-outbox-course.sh
#   scripts/verify-outbox-course.sh --help

set -euo pipefail

cd "$(dirname "$0")/.."

case "${1:-}" in
	--help|-h) sed -n '/^# Usage :/,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^#\{0,1\} \{0,1\}//'; exit 0 ;;
	'') ;;
	*) echo "ERREUR : option inconnue « $1 ». Voir --help." >&2; exit 2 ;;
esac

# shellcheck source=scripts/lib/conteneur.sh
source scripts/lib/conteneur.sh
# @spec CRM-115 (docs/BACKLOG.md) T2, docs/SPEC-pile-par-session.md §6 : le conteneur se désigne par son service.
DB_CONTAINER=$(conteneur db)

# Le seed (docs/SPEC-seed.md) : l'espace de démonstration, l'affaire c1, Camille (administratrice) autrice de l'envoi.
WORKSPACE=5eed0000-0000-4000-8000-000000000001
CARTE=5eed0000-0000-4000-8000-0000000000c1
AUTRICE=5eed0000-0000-4000-8000-000000000011
ESSAIS=3

CONTROLES=0
ok() { CONTROLES=$((CONTROLES + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { printf '  \033[31mÉCHEC\033[0m %s\n' "$1" >&2; exit 1; }

# Une requête ponctuelle, hors des deux sessions : la mise en place, les constats, le nettoyage.
ponctuel() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtAX -v ON_ERROR_STOP=1 -c "$1"; }

# --- Les deux sessions pilotées -------------------------------------------------------------------------------------
# Chacune est un `psql` qui lit une FIFO et écrit dans une autre : on lui écrit une requête suivie d'un repère, et on
# lit jusqu'au repère. Les erreurs (stderr) sont mêlées à la sortie, pour lire le refus tel que la base le lève.
TUBES=$(mktemp -d)
ouvrir() { # $1 : A | B
	mkfifo "$TUBES/$1.entree" "$TUBES/$1.sortie"
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtAX -v ON_ERROR_STOP=0 \
		<"$TUBES/$1.entree" >"$TUBES/$1.sortie" 2>&1 &
	if [ "$1" = A ]; then
		PID_A=$!; exec {ECRIT_A}>"$TUBES/A.entree"; exec {LIT_A}<"$TUBES/A.sortie"
	else
		PID_B=$!; exec {ECRIT_B}>"$TUBES/B.entree"; exec {LIT_B}<"$TUBES/B.sortie"
	fi
}
REPERE=''
envoyer() { # $1 : A | B ; $2 : SQL — n'attend rien ; pose REPERE
	local fd
	if [ "$1" = A ]; then fd=$ECRIT_A; else fd=$ECRIT_B; fi
	REPERE="__REPERE_$(date +%s%N)__"
	printf '%s\n\\echo %s\n' "$2" "$REPERE" >&"$fd"
}
lire() { # $1 : A | B ; $2 : repère ; $3 : délai en secondes — pose SORTIE ; 1 si le repère n'est pas venu
	local fd ligne
	if [ "$1" = A ]; then fd=$LIT_A; else fd=$LIT_B; fi
	SORTIE=''
	while IFS= read -r -t "$3" ligne <&"$fd"; do
		[ "$ligne" = "$2" ] && return 0
		SORTIE+="$ligne"$'\n'
	done
	return 1
}
executer() { # $1 : A | B ; $2 : SQL — attend la fin (10 s au plus) ; pose SORTIE
	envoyer "$1" "$2"
	lire "$1" "$REPERE" 10 || fail "la session $1 n'a pas répondu à : $2 (sortie : $SORTIE)"
}
fermer() {
	if [ -n "${PID_A:-}" ]; then
		printf 'rollback;\n\\q\n' >&"$ECRIT_A" 2>/dev/null || true
		exec {ECRIT_A}>&- {LIT_A}<&-; wait "$PID_A" 2>/dev/null || true; PID_A=''
	fi
	if [ -n "${PID_B:-}" ]; then
		printf 'rollback;\n\\q\n' >&"$ECRIT_B" 2>/dev/null || true
		exec {ECRIT_B}>&- {LIT_B}<&-; wait "$PID_B" 2>/dev/null || true; PID_B=''
	fi
	rm -f "$TUBES"/*.entree "$TUBES"/*.sortie
}

ENVOI=''
nettoyer() {
	fermer
	if [ -n "$ENVOI" ]; then
		ponctuel "delete from public.card_events where type = 'mail_cancelled' and payload ->> 'outbox_id' = '$ENVOI';
		          delete from public.mail_outbox where id = '$ENVOI';" >/dev/null || true
		ENVOI=''
	fi
}
trap 'nettoyer; rm -rf "$TUBES"' EXIT

# Endosser l'autrice, le temps de la transaction ouverte (comme PostgREST le fait d'un jeton).
ENDOSSER="select set_config('request.jwt.claims', json_build_object('sub', '$AUTRICE', 'role', 'authenticated')::text, true);
set local role authenticated;"

# L'envoi de la preuve : dans la file, pas encore dû — le worker ne peut pas le prendre.
creer_envoi() {
	ENVOI=$(ponctuel "insert into public.mail_outbox (workspace_id, identity_id, card_id, to_addrs, subject, body_text,
	                         status, created_by, next_attempt_at, created_at)
	                  values ('$WORKSPACE',
	                          (select i.id from public.mail_outbound_identities i where i.owner_id = '$AUTRICE'
	                            order by i.created_at limit 1),
	                          '$CARTE', array['client@exterieur.test'], 'Preuve de la course CRM-144', 'Corps.',
	                          'queued', '$AUTRICE', now() + interval '1 day', '2000-01-01')
	                  returning id;")
	[ -n "$ENVOI" ] || fail "l'envoi de la preuve n'a pas été créé"
}
rendre_du() { ponctuel "update public.mail_outbox set next_attempt_at = now() - interval '1 minute' where id = '$ENVOI';" >/dev/null; }
etat() { ponctuel "select status from public.mail_outbox where id = '$ENVOI';"; }
lignes_annulees() { ponctuel "select count(*) from public.card_events where type = 'mail_cancelled' and payload ->> 'outbox_id' = '$ENVOI';"; }
pid_de() { executer "$1" "select pg_backend_pid();"; PID_SERVEUR=$(tr -d '[:space:]' <<<"$SORTIE"); }

printf '\nLa course entre l'"'"'annulation et la passe d'"'"'envoi (CRM-144, §28.5)\n\n'

ponctuel "select 1 from pg_proc where proname = 'cancel_outbound_email'" | grep -q 1 \
	|| fail "la migration 0176 n'est pas appliquée (cancel_outbound_email absente)"

# --- Ordre 1 : l'annulation verrouille d'abord ---------------------------------------------------------------------
ordre_1() {
	creer_envoi
	ouvrir A; ouvrir B
	executer A "begin;"
	executer A "$ENDOSSER"
	rendre_du
	executer A "select public.cancel_outbound_email('$ENVOI');"
	if grep -q 'outbox_sending' <<<"$SORTIE"; then ISSUE=worker; return 0; fi
	grep -qE '^[0-9]{4}-' <<<"$SORTIE" || fail "ordre 1 — l'annulation, verrou tenu, devait rendre sa date ; elle rend : $SORTIE"

	# B joue la passe pendant que A tient le verrou ; puis l'annule, pour ne rien réserver pour de bon.
	executer B "begin;"
	executer B "select outbox_id from public.reserver_envois(50);"
	grep -q "$ENVOI" <<<"$SORTIE" && fail "ordre 1 — la passe a réservé un envoi dont l'annulation tient le verrou"
	executer B "rollback;"
	[ "$(etat)" = queued ] || fail "ordre 1 — avant la validation, la ligne validée devait rester « queued », elle est « $(etat) »"

	executer A "commit;"
	executer B "begin;"
	executer B "select outbox_id from public.reserver_envois(50);"
	grep -q "$ENVOI" <<<"$SORTIE" && fail "ordre 1 — après la validation, la passe a réservé un envoi annulé"
	executer B "rollback;"

	[ "$(etat)" = cancelled ] || fail "ordre 1 — l'envoi devait être « cancelled », il est « $(etat) »"
	[ "$(lignes_annulees)" = 1 ] || fail "ordre 1 — le fil devait porter une ligne « mail_cancelled », il en porte $(lignes_annulees)"
	ISSUE=fait
}

# --- Ordre 2 : la passe verrouille d'abord -------------------------------------------------------------------------
ordre_2() {
	creer_envoi
	ouvrir A; ouvrir B
	local pid_a r attente
	pid_de A; pid_a=$PID_SERVEUR
	rendre_du
	executer B "begin;"
	executer B "select outbox_id from public.reserver_envois(1);"
	if ! grep -q "$ENVOI" <<<"$SORTIE"; then
		executer B "rollback;"
		[ "$(etat)" = queued ] && fail "ordre 2 — la passe devait réserver l'envoi le plus ancien et dû ; elle rend : $SORTIE"
		ISSUE=worker; return 0
	fi

	executer A "begin;"
	executer A "$ENDOSSER"
	envoyer A "select public.cancel_outbound_email('$ENVOI');"; r=$REPERE
	# A doit ATTENDRE le verrou de B : constaté par la base, pas supposé.
	attente=''
	for _ in $(seq 1 50); do
		attente=$(ponctuel "select wait_event_type from pg_stat_activity where pid = $pid_a;")
		[ "$attente" = Lock ] && break
		sleep 0.1
	done
	[ "$attente" = Lock ] || fail "ordre 2 — l'annulation devait attendre le verrou de la passe ; état d'attente : « $attente »"
	ok "ordre 2 — l'annulation attend le verrou tenu par la passe (pg_stat_activity : Lock)"

	executer B "commit;"
	lire A "$r" 10 || fail "ordre 2 — l'annulation n'a pas repris après la validation de la passe"
	grep -q 'outbox_sending' <<<"$SORTIE" || fail "ordre 2 — l'annulation, débloquée, devait refuser « outbox_sending » ; elle rend : $SORTIE"
	executer A "rollback;"

	[ "$(etat)" = sending ] || fail "ordre 2 — l'envoi devait être « sending », il est « $(etat) »"
	[ "$(lignes_annulees)" = 0 ] || fail "ordre 2 — le fil ne devait porter aucune ligne « mail_cancelled », il en porte $(lignes_annulees)"
	ISSUE=fait
}

jouer() { # $1 : ordre_1 | ordre_2 ; $2 : libellé
	local essai
	for essai in $(seq 1 "$ESSAIS"); do
		ISSUE=''
		"$1"
		nettoyer
		if [ "$ISSUE" = fait ]; then ok "$2"; return 0; fi
		echo "  ...   le worker a pris l'envoi avant la preuve (essai $essai sur $ESSAIS) : l'ordre est rejoué"
	done
	fail "$2 — le worker a pris l'envoi à chaque essai ; la preuve n'a pas pu être jouée"
}

jouer ordre_1 "ordre 1 — l'annulation tient le verrou : la passe ne réserve rien, ni pendant ni après ; « cancelled », une ligne au fil"
jouer ordre_2 "ordre 2 — la passe tient le verrou : l'annulation, débloquée, refuse « outbox_sending » ; « sending », aucune ligne au fil"

printf '\n\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$CONTROLES"
