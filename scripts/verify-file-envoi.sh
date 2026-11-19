#!/usr/bin/env bash
# @verifies CRM-158 (docs/BACKLOG.md) — le contrôle 10 du vérificateur de production, joué contre la pile locale : la file
#           réelle est à jour (la boucle d'envoi tourne), un envoi dû vieilli et un orphelin, posés dans une transaction
#           ANNULÉE, le font chacun rougir en les nommant (docs/SPEC-mail-subsystem.md §34.6, §34.11 ; décision 954)
#
# `scripts/spark/verifier.sh` ne se joue que contre la cellule. Sa requête et son jugement vivent donc dans
# `scripts/lib/file-envoi.sh`, que ce script éprouve ici, par le même `psql -qtAX` dans le conteneur de la base.
#
# RIEN NE RESTE : chaque dégradation est un `insert` suivi de la requête, dans une transaction que `rollback` défait. Les
# lignes posées sont des copies d'un envoi existant du seed, sous un identifiant neuf.
#
# Usage :
#   scripts/verify-file-envoi.sh
#   scripts/verify-file-envoi.sh --help

set -euo pipefail

cd "$(dirname "$0")/.."

case "${1:-}" in
	--help|-h) sed -n '/^# Usage :/,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^#\{0,1\} \{0,1\}//'; exit 0 ;;
	'') ;;
	*) echo "ERREUR : option inconnue « $1 ». Voir --help." >&2; exit 2 ;;
esac

# shellcheck source=scripts/lib/conteneur.sh
source scripts/lib/conteneur.sh
# shellcheck source=scripts/lib/file-envoi.sh
source scripts/lib/file-envoi.sh
DB_CONTAINER=$(conteneur db)

CONTROLES=0
ECHECS=0
ok() { CONTROLES=$((CONTROLES + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { CONTROLES=$((CONTROLES + 1)); ECHECS=$((ECHECS + 1)); printf '  \033[31mÉCHEC\033[0m %s\n' "$1" >&2; }

psql_base() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtAX -v ON_ERROR_STOP=1; }

# degrader <statut> <colonnes jsonb> : la ligne de la requête, après l'insertion d'une copie dégradée, puis `rollback`.
degrader() {
	{
		echo "begin;"
		cat <<SQL
insert into public.mail_outbox
select (jsonb_populate_record(null::public.mail_outbox, to_jsonb(o) || jsonb_build_object(
	'id', gen_random_uuid(), 'status', '$1', 'attempts', 0, 'last_error', null, 'sent_at', null, 'sent_message_id', null,
	'rfc822_message_id', null) || $2)).*
  from public.mail_outbox o where o.card_id is not null order by o.created_at limit 1;
SQL
		file_envoi_requete
		echo "rollback;"
	} | psql_base
}

echo "Contrôle 10 — la file d'envoi ne vieillit pas (scripts/lib/file-envoi.sh)"

# 0. Le jeu porte au moins un envoi d'affaire à copier.
[ "$(echo "select count(*) from public.mail_outbox where card_id is not null;" | psql_base)" -ge 1 ] \
	|| { fail "aucun envoi d'affaire à copier : le seed des envois (§35, §42) est-il appliqué ?"; exit 1; }

# 1. TÉMOIN : la file réelle est à jour — la boucle d'envoi de mail-sync tourne.
if constat=$(file_envoi_juger "$(file_envoi_requete | psql_base)"); then ok "témoin, la file réelle : $constat"
else fail "témoin, la file réelle : $constat"; fi

# 2. Un envoi dû depuis une heure fait rougir le contrôle, et il est compté.
ligne=$(degrader queued "jsonb_build_object('next_attempt_at', now() - interval '1 hour', 'reserved_at', null)")
if constat=$(file_envoi_juger "$ligne"); then fail "un envoi dû depuis une heure n'est pas vu : $constat"
elif [[ "$constat" == *"envoi(s) dû(s)"* && "${ligne%%|*}" -ge 1 ]]; then ok "un envoi dû depuis une heure est nommé : $constat"
else fail "un envoi dû depuis une heure est mal nommé : $constat"; fi

# 3. Un orphelin réservé depuis une heure fait rougir le contrôle, et il est compté.
ligne=$(degrader sending "jsonb_build_object('next_attempt_at', now(), 'reserved_at', now() - interval '1 hour')")
orphelins=$(cut -d'|' -f2 <<< "$ligne")
if constat=$(file_envoi_juger "$ligne"); then fail "un orphelin réservé depuis une heure n'est pas vu : $constat"
elif [ "$orphelins" -ge 1 ]; then ok "un orphelin réservé depuis une heure est nommé : $constat"
else fail "un orphelin réservé depuis une heure est mal compté : $ligne"; fi

# 4. Une réponse illisible (une base injoignable, un `psql` refusé) n'est jamais un succès.
if constat=$(file_envoi_juger ""); then fail "une réponse vide passe pour une file à jour : $constat"
else ok "une réponse vide est un échec : $constat"; fi

# 5. Rien n'est resté : les dégradations ont été défaites.
[ "$(echo "select count(*) from public.mail_outbox where status = 'sending' and reserved_at < now() - interval '15 minutes';" | psql_base)" = 0 ] \
	&& ok "les dégradations sont défaites : aucun orphelin dans la base" || fail "un orphelin est resté dans la base"

# 6. Le vérificateur de production emploie bien cette bibliothèque, et rien d'autre, pour son contrôle 10.
grep -q 'source "$(dirname "${BASH_SOURCE\[0\]}")/../lib/file-envoi.sh"' scripts/spark/verifier.sh \
	&& grep -q 'file_envoi_juger "$(file_envoi_requete | distant' scripts/spark/verifier.sh \
	&& ok "scripts/spark/verifier.sh joue ce contrôle par scripts/lib/file-envoi.sh" \
	|| fail "scripts/spark/verifier.sh ne joue pas le contrôle 10 par scripts/lib/file-envoi.sh"

echo "Bilan : $CONTROLES contrôles, $ECHECS échec(s)."
[ "$ECHECS" = 0 ]
