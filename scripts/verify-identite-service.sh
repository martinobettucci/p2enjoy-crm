#!/usr/bin/env bash
# @verifies INC-335 (docs/BACKLOG.md, « Correctif arbitré le 2026-11-01 — INC-335 (décision 805) », tranche T1) —
#           l'identité de service ne s'emprunte plus, et les cadences armées avec elle sont fermées par la migration
# @verifies docs/SPEC-mail-subsystem.md §14.2, §19.4 (`identity_not_available`) ; docs/SPEC-modeles-emails.md §12.4
#           (refus e), §12.7 (`identity_withdrawn`) ; docs/SCHEMA.md (`card_sequence_enrollments.closed_reason`) ;
#           docs/JOURNAL.md décision 805 ; CLAUDE.md §10 (la règle vit en base, prouvée hors interface)
#
# CE QUE CE HARNAIS PROUVE, ET QU'AUCUNE SUITE pgTAP NE PEUT PROUVER SEULE : la FERMETURE des cadences déjà armées avec
# l'identité de service. Elle n'a lieu qu'une fois, au passage de la migration ; pour la voir, il faut une cadence
# active armée avec l'identité de service AVANT la migration, ce que la base à jour ne permet plus de produire par
# l'armement. Le harnais la pose donc en propriétaire, puis REJOUE le texte de la migration, et mesure.
#
# TOUT TIENT DANS UNE TRANSACTION, défaite par `rollback` : la préparation, le texte de la migration, et les
# assertions. Le DDL de PostgreSQL est transactionnel, si bien que rien de ce rejeu ne survit — ni ligne, ni
# fonction, ni contrainte. Le harnais ne laisse donc aucune structure en l'état d'une migration ancienne (INC-304) :
# il rejoue la dernière qui touche ces objets, dans une transaction annulée.
#
# Usage : scripts/verify-identite-service.sh — pile de développement démarrée, seed appliqué.

set -euo pipefail

cd "$(dirname "$0")/.."

source scripts/lib/conteneur.sh
DB_CONTAINER=$(conteneur db)
MIGRATION=supabase/migrations/0149_identite_service_reservee.sql
SUITES_SQL=(
	supabase/tests/0030_envoi_sortant.test.sql
	supabase/tests/0058_armement_sequences.test.sql
	supabase/tests/0096_envoi_cci_pieces_jointes.test.sql
)
CAMILLE=5eed0000-0000-4000-8000-000000000011
CARD_FIGEE=5eed0000-0000-4000-8000-0000000000c4
CARD_TEMOIN=5eed0000-0000-4000-8000-0000000000c1

controles=0
anomalies=0
ok()   { controles=$((controles + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { controles=$((controles + 1)); anomalies=$((anomalies + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n%s\n' "$1"; }

psql_db() {
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 "$@"
}

TRAVAIL=$(mktemp -d)
# LA SÉQUENCE DU SEED, lue par son nom : son identifiant est engendré par le vrai chemin d'écriture, il n'est pas stable.
trap 'rm -rf -- "$TRAVAIL"' EXIT

if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER absent. Lancez ./runDev.sh." >&2
	exit 1
fi

# --- 1. La base à jour -----------------------------------------------------------------------------------------------

titre "1. La règle d'emprunt et la contrainte, dans la base à jour"

for fonction in 'public.queue_outbound_email' 'public.armer_sequence_relance'; do
	if psql_db -c "select prosrc from pg_proc where oid = '$fonction'::regproc;" \
		| grep -q 'owner_id is null and app.is_workspace_admin'; then
		fail "$fonction ouvre encore l'identité de service aux administrateurs"
	else
		ok "$fonction n'ouvre plus l'identité de service : « la sienne, et elle seule »"
	fi
done

if psql_db -c "select pg_get_constraintdef(oid) from pg_constraint
	where conrelid = 'public.card_sequence_enrollments'::regclass
	  and conname = 'card_sequence_enrollments_motif_borne';" | grep -q identity_withdrawn; then
	ok "la contrainte des motifs connaît la cinquième fin, identity_withdrawn"
else
	fail "la contrainte des motifs ignore identity_withdrawn"
fi

actives_service=$(psql_db -c "select count(*) from public.card_sequence_enrollments e
	join public.mail_outbound_identities i on i.id = e.identity_id
	where e.status = 'active' and i.owner_id is null;")
if [ "$actives_service" = 0 ]; then
	ok "aucune cadence active ne porte l'identité de service"
else
	fail "$actives_service cadence(s) active(s) portent encore l'identité de service"
fi

# --- 2. Le rejeu de la migration, dans une transaction annulée -------------------------------------------------------

SEQUENCE_SEED=$(psql_db -c "select id from public.mail_sequences where name = 'Relance en trois temps' limit 1;")
[ -n "$SEQUENCE_SEED" ] || { echo "ERREUR : la séquence « Relance en trois temps » du seed est introuvable." >&2; exit 1; }

titre "2. La migration ferme les cadences armées avec l'identité de service, et elles seules"

{
	cat <<SQL
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- UNE CADENCE ARMÉE AVEC L'IDENTITÉ DE SERVICE, comme la production peut en porter avant la migration. Elle est posée
-- en propriétaire : l'armement la refuse désormais, et c'est précisément ce que la migration rattrape.
insert into public.card_sequence_enrollments (workspace_id, card_id, placement_id, sequence_id, identity_id, armed_by)
select c.workspace_id, c.id, app.card_first_placement(c.id), '$SEQUENCE_SEED',
       (select id from public.mail_outbound_identities where owner_id is null), '$CAMILLE'
  from public.cards c where c.id = '$CARD_FIGEE'
returning id as inscription_service \gset

-- LE TÉMOIN : une cadence armée avec l'identité de Camille, que la migration ne doit pas toucher.
insert into public.card_sequence_enrollments (workspace_id, card_id, placement_id, sequence_id, identity_id, armed_by)
select c.workspace_id, c.id, app.card_first_placement(c.id), '$SEQUENCE_SEED',
       (select id from public.mail_outbound_identities where owner_id = '$CAMILLE'), '$CAMILLE'
  from public.cards c where c.id = '$CARD_TEMOIN'
returning id as inscription_temoin \gset

select is((select count(*)::integer from public.card_sequence_enrollments
            where id in (:'inscription_service', :'inscription_temoin') and status = 'active'),
          2, 'MONTAGE : les deux cadences sont actives avant le rejeu');
SQL
	cat "$MIGRATION"
	cat <<'SQL'

select is((select status || '/' || closed_reason from public.card_sequence_enrollments where id = :'inscription_service'),
          'closed/identity_withdrawn',
          'la cadence armée avec l''identité de service est FERMÉE, sous identity_withdrawn — non manual');
select ok((select closed_at is not null from public.card_sequence_enrollments where id = :'inscription_service'),
          'elle porte son instant de fermeture');
select is((select status from public.card_sequence_enrollments where id = :'inscription_temoin'),
          'active',
          'TÉMOIN : la cadence armée avec une identité personnelle reste active');
SQL
	echo
	cat "$MIGRATION"
	cat <<'SQL'

select is((select status from public.card_sequence_enrollments where id = :'inscription_temoin'),
          'active',
          'IDEMPOTENCE : un second rejeu ne ferme toujours pas le témoin');
select is((select closed_reason from public.card_sequence_enrollments where id = :'inscription_service'),
          'identity_withdrawn',
          'IDEMPOTENCE : un second rejeu laisse la fermeture telle quelle');
select * from finish();
rollback;
SQL
} > "$TRAVAIL/rejeu.sql"

code=0
psql_db -f - < "$TRAVAIL/rejeu.sql" > "$TRAVAIL/rejeu.tap" 2>&1 || code=$?
if [ "$code" -ne 0 ]; then
	fail "le rejeu a échoué (psql, code $code) — $(tail -n 5 "$TRAVAIL/rejeu.tap" | tr '\n' ' ')"
elif grep -q '^not ok' "$TRAVAIL/rejeu.tap"; then
	fail "le rejeu ROUGIT — $(grep '^not ok' "$TRAVAIL/rejeu.tap" | tr '\n' ' ')"
else
	reussies=$(grep -c '^ok ' "$TRAVAIL/rejeu.tap" || true)
	if [ "$reussies" = 6 ]; then
		ok "rejeu de $(basename "$MIGRATION") dans une transaction annulée : 6 assertions, aucune anomalie"
	else
		fail "rejeu : $reussies assertion(s) vertes au lieu de 6 — $(tail -n 5 "$TRAVAIL/rejeu.tap" | tr '\n' ' ')"
	fi
fi

restantes=$(psql_db -c "select count(*) from public.card_sequence_enrollments
	where card_id in ('$CARD_FIGEE', '$CARD_TEMOIN');")
if [ "$restantes" = 0 ]; then
	ok "le rollback a tout défait : aucune inscription d'essai ne subsiste"
else
	fail "$restantes inscription(s) d'essai subsistent — le rejeu n'a pas été annulé"
fi

# --- 3. Les suites pgTAP de la garde d'envoi et de l'armement --------------------------------------------------------

titre "3. Les suites pgTAP révisées par la décision 805"

for suite in "${SUITES_SQL[@]}"; do
	if scripts/run-sql-tests.sh "$suite" > "$TRAVAIL/suite.log" 2>&1; then
		ok "$(basename "$suite") verte"
	else
		fail "$(basename "$suite") ROUGIT — $(grep -E 'ECHEC|not ok' "$TRAVAIL/suite.log" | head -n 5 | tr '\n' ' ')"
	fi
done

echo
if [ "$anomalies" -eq 0 ]; then
	echo "Bilan : $controles contrôles, aucune anomalie."
	exit 0
fi
echo "Bilan : $controles contrôles, $anomalies anomalie(s)." >&2
exit 1
