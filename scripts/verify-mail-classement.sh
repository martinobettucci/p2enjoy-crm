#!/usr/bin/env bash
# @verifies CRM-055 (docs/BACKLOG.md) — Definition of Done du classement assisté
# @verifies CRM-060 tranche 2 (docs/BACKLOG.md) — activation de la règle 3 du classement
# @verifies docs/SPEC-mail-subsystem.md §4.4 (les quatre règles), §16.2 (forme ET domaine, card
#           fermée, la règle 3), §16.3 (classement manuel), §16.4 (preuves)
# @verifies docs/SPEC-contacts.md §8 (la suggestion par expéditeur connu)
# @verifies docs/JOURNAL.md décision 322 ; CLAUDE.md §10
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les fichiers livrés portent leur traçabilité ;
#   2. le vocabulaire de la timeline compte ONZE types, et `mail_received` en fait partie ;
#   3. le classement automatique n'est PAS offert au client, le manuel l'est ;
#   4. la règle 3 est ACTIVE : un expéditeur contact à exactement une card active reçoit une
#      SUGGESTION, sans être classé — avec son témoin (un inconnu ne suggère rien) ;
#   5. les preuves dédiées sont vertes : pgTAP (0027 et 0044), API, `mail` ;
#   6. le harnais est NON COMPLAISANT, témoin compris.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# LA SUGGESTION DE LA RÈGLE 3 N'A PAS D'ÉCRAN : l'inbox qui la montrerait est due par `CRM-057`.
# Le harnais prouve la RÈGLE en base ; la preuve visible attend l'écran.
#
# AUCUN DÉCLASSEMENT : rien dans le §4.4 ne le décrit.
#
# Usage :
#   scripts/verify-mail-classement.sh
#   scripts/verify-mail-classement.sh --rapide   n'exécute pas Playwright

set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

MIGRATION=supabase/migrations/0025_classement_messages.sql
TEST_SQL=supabase/tests/0027_classement_messages.test.sql
TEST_SQL_R3=supabase/tests/0044_regle3_suggestion.test.sql
SPEC_API=e2e/api/classement.spec.ts
SPEC_MAIL=e2e/mail/ingestion.spec.ts
DB_CONTAINER=p2enjoy-db

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,30p' "$0"; exit 0 ;;
		*) echo "option inconnue « $1 ». Voir --help." >&2; exit 1 ;;
	esac
	shift
done

failures=0; checks=0
ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }
psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

TRAVAIL=$(mktemp -d)
RAPPORTS=e2e/output/verify-mail-classement
mkdir -p "$RAPPORTS"
fail_journal() {
	local message=$1 journal=$2
	cp "$journal" "$RAPPORTS/$(basename "$journal")" 2>/dev/null || true
	fail "$message — voir $RAPPORTS/$(basename "$journal")"
	tail -n 25 "$journal" | sed 's/^/        /'
}
trap 'rm -rf "$TRAVAIL"' EXIT

printf '\033[1mPreuves de CRM-055 — classement assisté\033[0m\n'

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MIGRATION" "$TEST_SQL" "$SPEC_API"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done
if head -3 "$MIGRATION" | grep -q '@spec CRM-055'; then
	ok "$(basename "$MIGRATION") porte son commentaire @spec"
else
	fail "$(basename "$MIGRATION") ne cite pas son unité"
fi
for fichier in "$TEST_SQL" "$SPEC_API"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-055'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité"
	fi
done

titre "2. Les règles réellement en base"

if psql_db -c "select pg_get_constraintdef(oid) from pg_constraint
	where conrelid='public.card_events'::regclass and conname='card_events_type_check'" \
	| grep -q mail_received; then
	ok "le vocabulaire de la timeline compte ONZE types, dont mail_received"
else
	fail "mail_received n'est pas dans le vocabulaire : un message entrant serait muet"
fi

for fonction in classify_message classer_message_automatiquement; do
	if [ "$(psql_db -c "select count(*) from pg_proc where pronamespace='public'::regnamespace
		and proname='$fonction'")" = 1 ]; then
		ok "$fonction est livrée"
	else
		fail "$fonction est ABSENTE"
	fi
done

if [ "$(psql_db -c "select has_function_privilege('authenticated','public.classer_message_automatiquement(uuid, text, text[])','execute')")" = f ]; then
	ok "le classement AUTOMATIQUE n'est pas offert au client : c'est un constat de la relève"
else
	fail "un client peut déclarer qu'une règle s'est appliquée alors qu'elle ne l'a pas fait"
fi

if [ "$(psql_db -c "select has_function_privilege('authenticated','public.classify_message(uuid, uuid)','execute')")" = t ]; then
	ok "le classement MANUEL est offert à un membre connecté"
else
	fail "classify_message n'est pas appelable : la Definition of Done l'exige"
fi

# LA RÈGLE 3 EST ACTIVE (CRM-060 tranche 2). Elle ne classe pas, elle SUGGÈRE : un expéditeur
# contact rattaché à EXACTEMENT une card active reçoit sa card en `suggested_card_id`, le message
# restant non classé. On l'éprouve sur la donnée du seed — Léo Marchand, une seule card active
# …00c2 — DANS UNE TRANSACTION ROULÉE EN ARRIÈRE, avec son témoin : un expéditeur inconnu ne
# suggère rien. Sans le témoin, une règle qui suggérerait TOUJOURS passerait pour juste.
VERDICT_R3="$(psql_db <<'SQL' | grep '|'
begin;
insert into public.mail_messages (id, workspace_id, rfc822_message_id, from_address)
values ('cccc0000-0000-4000-8000-000000000001','5eed0000-0000-4000-8000-000000000001',
        '<harnais-r3-leo>','leo.marchand@sogexia.example');
select public.classer_message_automatiquement('cccc0000-0000-4000-8000-000000000001', null, null);
insert into public.mail_messages (id, workspace_id, rfc822_message_id, from_address)
values ('cccc0000-0000-4000-8000-000000000002','5eed0000-0000-4000-8000-000000000001',
        '<harnais-r3-inconnu>','personne@nulle-part.test');
select public.classer_message_automatiquement('cccc0000-0000-4000-8000-000000000002', null, null);
select coalesce((select suggested_card_id::text from public.mail_messages
                  where id='cccc0000-0000-4000-8000-000000000001'), 'AUCUNE')
    || '|' || coalesce((select suggested_card_id::text from public.mail_messages
                  where id='cccc0000-0000-4000-8000-000000000002'), 'AUCUNE')
    || '|' || (select classification from public.mail_messages
                  where id='cccc0000-0000-4000-8000-000000000001');
rollback;
SQL
)"
R3_SUGGERE="$(printf '%s' "$VERDICT_R3" | cut -d'|' -f1)"
R3_TEMOIN="$(printf '%s' "$VERDICT_R3" | cut -d'|' -f2)"
R3_CLASSE="$(printf '%s' "$VERDICT_R3" | cut -d'|' -f3)"

if [ "$R3_SUGGERE" = "5eed0000-0000-4000-8000-0000000000c2" ]; then
	ok "RÈGLE 3 active : un expéditeur contact à une seule card active est SUGGÉRÉ vers elle"
else
	fail "RÈGLE 3 muette : Léo aurait dû être suggéré vers …00c2, obtenu « $R3_SUGGERE »"
fi

if [ "$R3_CLASSE" = "unclassified" ]; then
	ok "RÈGLE 3 SUGGÈRE sans classer : le message reste non classé"
else
	fail "RÈGLE 3 a CLASSÉ au lieu de suggérer : classification « $R3_CLASSE »"
fi

if [ "$R3_TEMOIN" = "AUCUNE" ]; then
	ok "témoin : un expéditeur inconnu ne suggère rien — la règle ne suggère pas à tort"
else
	fail "témoin ROUGE : un inconnu a reçu une suggestion « $R3_TEMOIN »"
fi

titre "3. Le classement ne s'invente pas"

# Aucun message classé ne doit exister sans son événement de timeline : la card garderait alors
# un message dont sa mémoire ne dit rien.
if [ "$(psql_db -c "select count(*) from public.mail_messages m
	where m.classification <> 'unclassified'
	  and not exists (select 1 from public.card_events e
	                   where e.card_id = m.card_id and e.type = 'mail_received')")" = 0 ]; then
	ok "aucun message classé sans son événement : la timeline garde la mémoire de chaque entrée"
else
	fail "un message est classé sans trace dans la timeline de sa card"
fi

if [ "$(psql_db -c "select count(*) from public.mail_messages
	where classification = 'auto' and classified_by is not null")" = 0 ]; then
	ok "aucun classement automatique ne s'attribue un auteur"
else
	fail "un classement automatique porte un auteur : un geste est attribué à quelqu'un à tort"
fi

if [ "$RAPIDE" = false ]; then
	titre "4. Preuves exécutables"

	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/pgtap.log" 2>&1; then
		assertions=$(grep -oE '[0-9]+ assertions' "$TRAVAIL/pgtap.log" | head -1 | grep -oE '[0-9]+')
		if [ "${assertions:-0}" -eq 20 ]; then
			ok "suite pgTAP du classement (0027) — 20 assertions"
		else
			fail "suite pgTAP verte mais ${assertions:-0} assertions au lieu de 20"
		fi
	else
		fail_journal "la suite pgTAP ÉCHOUE" "$TRAVAIL/pgtap.log"
	fi

	if npm run test:sql -- "$TEST_SQL_R3" >"$TRAVAIL/pgtap-r3.log" 2>&1; then
		assertions=$(grep -oE '[0-9]+ assertions' "$TRAVAIL/pgtap-r3.log" | head -1 | grep -oE '[0-9]+')
		if [ "${assertions:-0}" -eq 21 ]; then
			ok "suite pgTAP de la règle 3 (0044) — 21 assertions, cas a à h"
		else
			fail "suite pgTAP de la règle 3 verte mais ${assertions:-0} assertions au lieu de 21"
		fi
	else
		fail_journal "la suite pgTAP de la règle 3 ÉCHOUE" "$TRAVAIL/pgtap-r3.log"
	fi

	if E2E_PROJETS=api npx playwright test --config e2e/playwright.config.ts --project=api \
		"$SPEC_API" >"$TRAVAIL/api.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 5 ]; then
			ok "preuve d'API dédiée — 5 scénarios, dont le refus au viewer et la suggestion règle 3"
		else
			fail "preuve d'API verte mais ${passes:-0} scénarios au lieu de 5"
		fi
	else
		fail_journal "la preuve d'API ÉCHOUE" "$TRAVAIL/api.log"
	fi

	if E2E_PROJETS=mail npx playwright test --config e2e/playwright.config.ts --project=mail \
		"$SPEC_MAIL" >"$TRAVAIL/mail.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/mail.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 3 ]; then
			ok "preuve mail — un vrai email adressé à une card y est classé automatiquement"
		else
			fail "preuve mail verte mais ${passes:-0} scénarios au lieu de 3"
		fi
	else
		fail_journal "la preuve mail ÉCHOUE" "$TRAVAIL/mail.log"
	fi

	titre "5. Non-complaisance"

	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/temoin.log" 2>&1; then
		ok "témoin : la suite est VERTE avant toute dégradation"
	else
		fail_journal "témoin ROUGE : les dégradations ne prouveraient rien" "$TRAVAIL/temoin.log"
	fi

	# UNE DÉGRADATION QUI NE S'APPLIQUE PAS DOIT ÊTRE DITE, NON SUBIE. Sans ce garde-fou, un
	# `ALTER` refusé par une donnée existante faisait mourir le script sous `set -e`, et le
	# harnais s'arrêtait au milieu de sa section la plus importante — sans rien signaler.
	degradation_sql() {
		local libelle=$1 casser=$2 reparer=$3
		if ! psql_db -c "$casser" >"$TRAVAIL/degradation.log" 2>&1; then
			fail_journal "dégradation IMPOSSIBLE À APPLIQUER : $libelle" "$TRAVAIL/degradation.log"
			return
		fi
		if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/degrade.log" 2>&1; then
			fail "dégradation NON VUE : $libelle"
		else
			ok "dégradation vue : $libelle"
		fi
		if ! psql_db -c "$reparer" >"$TRAVAIL/reparation.log" 2>&1; then
			fail_journal "RESTAURATION IMPOSSIBLE : $libelle" "$TRAVAIL/reparation.log"
		fi
	}

	degradation_sql "la règle 1 ignorant le domaine — un correspondant classerait chez autrui" \
		"create or replace function app.card_par_adresse(p_workspace_id uuid, p_adresses text[])
		 returns uuid language sql security definer set search_path = '' stable as \$fn\$
		   select c.id from public.cards c
		    where c.workspace_id = p_workspace_id
		      and lower(c.email_local_part) = any (
		            select lower(split_part(btrim(a), '@', 1)) from unnest(p_adresses) as a)
		    limit 1 \$fn\$" \
		"create or replace function app.card_par_adresse(p_workspace_id uuid, p_adresses text[])
		 returns uuid language sql security definer set search_path = '' stable as \$fn\$
		   select c.id from public.cards c join public.workspaces w on w.id = c.workspace_id
		    where c.workspace_id = p_workspace_id and c.archived_at is null and c.deleted_at is null
		      and lower(c.email_local_part || '@' || w.inbound_domain) = any (
		            select lower(btrim(a)) from unnest(p_adresses) as a)
		    limit 1 \$fn\$"

	degradation_sql "le classement automatique ouvert à authenticated" \
		"grant execute on function public.classer_message_automatiquement(uuid, text, text[]) to authenticated" \
		"revoke execute on function public.classer_message_automatiquement(uuid, text, text[]) from authenticated"

	# LA DÉGRADATION NE PORTE PAS SUR LE VOCABULAIRE, ET C'EST MESURÉ : retirer `mail_received` du
	# `CHECK` échoue tant qu'une seule ligne le porte — et `card_events` n'accorde AUCUNE
	# suppression, à personne (`CRM-044`). Une dégradation impossible à appliquer ne prouve rien ;
	# celle-ci retire l'ÉCRITURE de l'événement, ce que la suite mesure au même endroit.
	degradation_sql "l'événement de timeline retiré du classement manuel — la card perdrait la mémoire" \
		"create or replace function public.classify_message(p_message_id uuid, p_card_id uuid)
		 returns uuid language plpgsql security definer set search_path = '' as \$fn\$
		 declare v_message public.mail_messages%rowtype; v_appelant uuid := (select auth.uid());
		 begin
		   select * into v_message from public.mail_messages m where m.id = p_message_id;
		   if not app.can_write_card(p_card_id) then
		     raise exception 'forbidden' using errcode = '42501';
		   end if;
		   update public.mail_messages m set card_id = p_card_id, classification = 'manual',
		          classified_by = v_appelant, classified_at = now() where m.id = p_message_id;
		   return p_card_id;
		 end \$fn\$" \
		"$(sed -n '/^create or replace function public.classify_message/,/^\\$\\$;$/p' \
		   supabase/migrations/0028_inbox_visibilite.sql)"

	titre "6. Restauration"
	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/restaure.log" 2>&1; then
		ok "la suite pgTAP redevient verte après restauration"
	else
		fail_journal "la suite pgTAP reste ROUGE après restauration" "$TRAVAIL/restaure.log"
	fi
fi

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%s contrôles, %s en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
