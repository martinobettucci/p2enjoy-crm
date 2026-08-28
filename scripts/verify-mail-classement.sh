#!/usr/bin/env bash
# @verifies CRM-055 (docs/BACKLOG.md) — Definition of Done du classement assisté, tranches 1 et 2
# @verifies CRM-060 tranche 2 (docs/BACKLOG.md) — activation de la règle 3 du classement
# @verifies docs/SPEC-mail-subsystem.md §4.4 (les quatre règles), §16.2 (forme ET domaine, card
#           fermée, la règle 3), §16.3 (classement manuel), §16.4 (preuves)
# @verifies docs/SPEC-mail-subsystem.md §16.5 (le DÉCLASSEMENT : contrat, borne de l'idempotence,
#           historique conservé, départ écrit, surface)
# @verifies docs/SPEC-contacts.md §8 (la suggestion par expéditeur connu)
# @verifies docs/JOURNAL.md décision 322 ; CLAUDE.md §10
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les fichiers livrés portent leur traçabilité ;
#   2. le vocabulaire de la timeline compte DIX-NEUF types, dont `mail_received` ET
#      `mail_unclassified` — l'arrivée d'un message et son départ sont deux faits ;
#   3. le classement automatique n'est PAS offert au client, le manuel l'est ;
#   4. la règle 3 est ACTIVE : un expéditeur contact à exactement une card active reçoit une
#      SUGGESTION, sans être classé — avec son témoin (un inconnu ne suggère rien) ;
#   5. les preuves dédiées sont vertes : pgTAP (0027 et 0044), API, `mail` ;
#   6. le DÉCLASSEMENT est livré et fermé : la fonction existe, elle est offerte à un membre
#      connecté et refusée à l'anonyme, aucun événement de départ n'est orphelin, et l'écran
#      porte sa commande avec son dictionnaire de refus PROPRE ;
#   7. le harnais est NON COMPLAISANT, témoin compris.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# ~~LA SUGGESTION DE LA RÈGLE 3 N'A PAS D'ÉCRAN.~~ **RÉVISÉ le 2026-08-20 par LIVRAISON** —
# `CRM-060` sous-tranche 2 bis, docs/SPEC-contacts.md §8.8. L'inbox MONTRE désormais la suggestion,
# et le seed en fait arriver une pour de bon. Ce harnais vérifie donc en plus, plus bas, que la
# surface et sa donnée de démonstration existent ; le PARCOURS, lui, reste l'objet de
# `e2e/ui/suggestion-classement.spec.ts`, qu'un harnais ne remplace pas.
#
# ~~AUCUN DÉCLASSEMENT : rien dans le §4.4 ne le décrit.~~ **RÉVISÉ le 2026-08-28 par LIVRAISON** —
# tranche 2, `docs/SPEC-mail-subsystem.md` §16.5, `docs/JOURNAL.md` décision 536. Le renvoi « à
# l'unité qui livrera l'écran » était caduc : cette unité, `CRM-057`, est livrée depuis le
# 2026-08-11 sans avoir tranché. Ce harnais vérifie donc en plus le contrat de base et la présence
# de la surface ; le PARCOURS reste l'objet de `e2e/ui/declassement.spec.ts`, qu'un harnais ne
# remplace pas.
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
MIGRATION_T2=supabase/migrations/0070_declassement_messages.sql
TEST_SQL=supabase/tests/0027_classement_messages.test.sql
TEST_SQL_T2=supabase/tests/0066_declassement_messages.test.sql
SPEC_UI_T2=e2e/ui/declassement.spec.ts
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

for fichier in "$MIGRATION" "$MIGRATION_T2" "$TEST_SQL" "$TEST_SQL_T2" "$SPEC_API" "$SPEC_UI_T2"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done
for fichier in "$MIGRATION" "$MIGRATION_T2"; do
	if head -3 "$fichier" | grep -q '@spec CRM-055'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité"
	fi
done
for fichier in "$TEST_SQL" "$TEST_SQL_T2" "$SPEC_API" "$SPEC_UI_T2"; do
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
	ok "le vocabulaire de la timeline porte mail_received : un message entrant est un fait"
else
	fail "mail_received n'est pas dans le vocabulaire : un message entrant serait muet"
fi

if psql_db -c "select pg_get_constraintdef(oid) from pg_constraint
	where conrelid='public.card_events'::regclass and conname='card_events_type_check'" \
	| grep -q mail_unclassified; then
	ok "le vocabulaire porte AUSSI mail_unclassified : le DÉPART d'un message est un fait (§16.5.3)"
else
	fail "mail_unclassified manque : la timeline dirait « courrier reçu » sur un message parti"
fi

for fonction in classify_message unclassify_message classer_message_automatiquement; do
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

titre "2 bis. La suggestion a une SURFACE, et une donnée de démonstration — CRM-060 sous-tranche 2 bis"

# @verifies CRM-060 (docs/BACKLOG.md) — sous-tranche 2 bis, docs/SPEC-contacts.md §8.8.3, §8.8.5,
#           §8.8.8 ; docs/DESIGN_SYSTEM.md §5.4 ter ; docs/SPEC-seed.md §2.19
#
# UNE RÈGLE LIVRÉE QUE RIEN NE MONTRE EST UNE RÈGLE INVISIBLE, et c'est l'état dans lequel la
# règle 3 a vécu du 2026-08-18 au 2026-08-20 : prouvée en base, absente de tout écran, et sans
# aucune donnée de démonstration pour la déclencher. Les contrôles ci-dessous mordent sur les DEUX
# manques, parce qu'ils se tiennent — une surface sans donnée n'a aucune capture, une donnée sans
# surface n'a aucun lecteur.

ECRAN_INBOX=webapp/src/app/RouteInbox.tsx
LIB_INBOX=webapp/src/lib/inbox.ts
SPEC_SUGGESTION=e2e/ui/suggestion-classement.spec.ts

# 1. LA COLONNE EST DEMANDÉE PAR LA LECTURE D'UN MESSAGE, et par elle seule : la demander pour la
#    LISTE rapporterait cinquante colonnes pour n'en afficher aucune (§8.8.3).
if grep -q 'suggested_card_id' "$LIB_INBOX"; then
	ok "$LIB_INBOX demande la colonne de suggestion"
else
	fail "$LIB_INBOX ne demande pas suggested_card_id : l'écran ne pourrait rien rendre"
fi
if grep -q "^export const COLONNES_LISTE" "$LIB_INBOX" \
	&& ! sed -n '/^export const COLONNES_LISTE/,/^$/p' "$LIB_INBOX" | grep -q 'suggested_card_id'; then
	ok "la colonne n'entre PAS dans les colonnes de liste (§8.8.3)"
else
	fail "suggested_card_id est demandée pour la LISTE : cinquante colonnes rapportées pour rien"
fi

# 2. L'ÉCRAN REND LE BLOC, ET IL LE REND AVEC SA RÈGLE. Un bloc qui nommerait l'affaire sans dire
#    d'où elle sort laisserait un indice sans origine, que personne ne peut confirmer (§8.8.5).
for marqueur in 'inbox-suggestion' 'inbox.suggestion.rule' 'inbox.suggestion.accept'; do
	if grep -q "$marqueur" "$ECRAN_INBOX" webapp/src/i18n/fr.ts; then
		ok "l'écran porte « $marqueur »"
	else
		fail "l'écran ne porte pas « $marqueur » : le bloc du §5.4 ter serait incomplet"
	fi
done

# 3. LE PARCOURS EXISTE, et il est rangé sous l'unité qui le livre.
if [ -f "$SPEC_SUGGESTION" ] && head -3 "$SPEC_SUGGESTION" | grep -q '@verifies CRM-060'; then
	ok "$SPEC_SUGGESTION est livré et cite son unité"
else
	fail "$SPEC_SUGGESTION est absent ou ne cite pas CRM-060"
fi

# 4. LA DONNÉE DE DÉMONSTRATION EXISTE POUR DE BON, et elle n'est pas forgée : le seed la fait
#    ARRIVER par une soumission authentifiée puis une relève réelle (docs/SPEC-seed.md §2.19).
#    Le contrôle porte sur l'ÉTAT, pas sur le script : un seed qui écrirait la ligne à la main
#    passerait un contrôle de texte et échouerait ici, `suggested_card_id` n'étant écrite que par
#    `classer_message_automatiquement`.
suggestion_seed=$(psql_db -c "select coalesce(suggested_card_id::text, 'aucune')
	from public.mail_messages
	where rfc822_message_id = '<seed-inbox-suggere@sogexia.example>'" | tr -d '[:space:]')
if [ "$suggestion_seed" = "5eed0000-0000-4000-8000-0000000000c2" ]; then
	ok "le message du correspondant porte sa suggestion vers …00c2"
else
	fail "le message du correspondant suggère « $suggestion_seed » : le bloc n'aurait rien à rendre"
fi

classement_seed=$(psql_db -c "select coalesce(classification, 'absent')
	from public.mail_messages
	where rfc822_message_id = '<seed-inbox-suggere@sogexia.example>'" | tr -d '[:space:]')
if [ "$classement_seed" = unclassified ]; then
	ok "il reste NON CLASSÉ : la règle 3 suggère, elle ne classe pas"
else
	fail "il est « $classement_seed » au lieu de « unclassified » : la règle 3 aurait classé"
fi

# 5. LA BOÎTE DU CORRESPONDANT N'EST PAS UN COMPTE ENTRANT DU PRODUIT (§11.4). Le CRM ne relève
#    jamais dedans ; l'y inscrire en ferait une boîte du workspace, ce qu'elle n'est pas.
comptes_correspondant=$(psql_db -c "select count(*) from public.mail_inbound_accounts
	where imap_username like '%@sogexia.example'" | tr -d '[:space:]')
if [ "$comptes_correspondant" = 0 ]; then
	ok "la boîte du correspondant n'est pas un compte entrant du produit"
else
	fail "le correspondant est déclaré comme compte entrant : le CRM relèverait dans une boîte étrangère"
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

titre "3 bis. Le DÉCLASSEMENT est fermé, et sa surface existe — §16.5"

if [ "$(psql_db -c "select has_function_privilege('authenticated','public.unclassify_message(uuid)','execute')")" = t ]; then
	ok "le retrait est offert à un membre connecté, comme le classement manuel"
else
	fail "le retrait est fermé à un membre connecté : le geste n'existerait pour personne"
fi

if [ "$(psql_db -c "select has_function_privilege('anon','public.unclassify_message(uuid)','execute')")" = f ]; then
	ok "et refusé à l'anonyme — révoqué NOMMÉMENT, `revoke from public` ne suffisant pas"
else
	fail "un anonyme peut retirer un message de son affaire"
fi

# LA SYMÉTRIE DES DROITS EST LE CONTRAT DU §16.5.2, et elle se LIT dans le corps de la fonction :
# les deux gardes du classement — voir le message, écrire la card — doivent s'y retrouver toutes
# les deux. Une seule des deux ferait du retrait un geste plus permissif que la pose.
corps_retrait=$(psql_db -c "select prosrc from pg_proc where pronamespace='public'::regnamespace
	and proname='unclassify_message'")
if grep -q 'peut_voir_message' <<<"$corps_retrait" && grep -q 'can_write_card' <<<"$corps_retrait"; then
	ok "le retrait exige LES DEUX droits du classement : on ne retire que ce qu'on aurait pu poser"
else
	fail "le retrait n'exige pas les deux droits du classement — la symétrie du §16.5.2 est rompue"
fi

# L'HISTOIRE N'EST PAS RÉÉCRITE : tout départ écrit doit avoir son arrivée sur la MÊME card. Un
# `mail_unclassified` orphelin dirait qu'un message est parti d'une affaire où il n'est jamais
# entré — et il signalerait que la fonction a effacé le `mail_received`, ce qu'elle ne doit
# jamais faire.
if [ "$(psql_db -c "select count(*) from public.card_events d
	where d.type = 'mail_unclassified'
	  and not exists (select 1 from public.card_events a
	                   where a.card_id = d.card_id and a.type = 'mail_received'
	                     and a.payload->>'message_id' = d.payload->>'message_id')")" = 0 ]; then
	ok "aucun départ orphelin : le mail_received d'origine est conservé, l'histoire ne se réécrit pas"
else
	fail "un mail_unclassified n'a pas son mail_received : l'historique a été réécrit"
fi

# LE DÉPART PORTE L'OBJET, et ce n'est pas un ornement : le geste détache le message de la card,
# si bien qu'aucun libellé ne peut plus être résolu à la lecture (§16.5.3).
if [ "$(psql_db -c "select count(*) from public.card_events
	where type = 'mail_unclassified' and payload->>'subject' is null
	  and exists (select 1 from public.mail_messages m
	               where m.id::text = payload->>'message_id' and m.subject is not null)")" = 0 ]; then
	ok "chaque départ porte l'OBJET du message : la ligne reste lisible sans le message"
else
	fail "un départ ne porte pas l'objet : la ligne du fil serait un identifiant illisible"
fi

# LA SURFACE EXISTE, ET SON DICTIONNAIRE DE REFUS EST PROPRE. Réemployer celui du classement
# afficherait « Vous ne pouvez pas classer… » sur un retrait — le défaut de la décision 535.
if grep -q "data-testid=\"inbox-retirer\"" webapp/src/app/RouteInbox.tsx; then
	ok "l'inbox porte la commande de retrait (§16.5.5)"
else
	fail "aucune commande de retrait dans l'inbox : le geste n'existe que par l'API"
fi

if grep -q 'inbox.unclassify.refus.forbidden' webapp/src/i18n/fr.ts &&
	grep -q 'LIBELLE_REFUS_RETRAIT' webapp/src/app/RouteInbox.tsx; then
	ok "le retrait a son PROPRE dictionnaire de refus — leçon de la décision 535"
else
	fail "le retrait réemploie le dictionnaire du classement : un refus nommerait le geste inverse"
fi

if grep -q "'mail_unclassified'" webapp/src/lib/timeline.ts &&
	grep -q 'timeline.event.mail_unclassified' webapp/src/i18n/fr.ts; then
	ok "le fil sait NOMMER le départ : il ne rendra pas « Événement » (INC-207, INC-220)"
else
	fail "le type est écrit en base et absent du registre de l'écran : le fil rendrait « Événement »"
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

	if npm run test:sql -- "$TEST_SQL_T2" >"$TRAVAIL/pgtap-t2.log" 2>&1; then
		assertions=$(grep -oE '[0-9]+ assertions' "$TRAVAIL/pgtap-t2.log" | head -1 | grep -oE '[0-9]+')
		if [ "${assertions:-0}" -eq 19 ]; then
			ok "suite pgTAP du déclassement (0066) — 19 assertions, borne de l'idempotence comprise"
		else
			fail "suite pgTAP du déclassement verte mais ${assertions:-0} assertions au lieu de 19"
		fi
	else
		fail_journal "la suite pgTAP du déclassement ÉCHOUE" "$TRAVAIL/pgtap-t2.log"
	fi

	if E2E_PROJETS=api npx playwright test --config e2e/playwright.config.ts --project=api \
		"$SPEC_API" >"$TRAVAIL/api.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1 | grep -oE '[0-9]+')
		# **7 DEPUIS LE 2026-08-20** — `CRM-060` sous-tranche 2 bis, docs/SPEC-contacts.md §8.8.3
		# et §8.8.7. Deux scénarios ajoutés, et ils disent ce que les cinq précédents ne disaient
		# pas : ceux-là appellent la chaîne avec la CLÉ DE SERVICE, qui ne prouve rien de ce qu'un
		# membre voit. Les deux nouveaux lisent la suggestion du seed sous les JETONS RÉELS —
		# l'administratrice la voit, le `business_developer` et la `viewer` reçoivent zéro ligne.
		# **9 DEPUIS LE 2026-08-28** — tranche 2, §16.5.6. Deux scénarios ajoutés, et ils disent
		# ce que les sept précédents ne disaient pas : le refus opposé à la lectrice sur un
		# RETRAIT, et la perte de visibilité du `bizdev` relue par la vraie route derrière son
		# propre geste. Compteur RÉVISÉ, jamais retiré (décision 51).
		if [ "${passes:-0}" -eq 9 ]; then
			ok "preuve d'API dédiée — 9 scénarios, dont le refus au viewer et la perte de visibilité"
		else
			fail "preuve d'API verte mais ${passes:-0} scénarios au lieu de 9"
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

	if E2E_PROJETS=ui npx playwright test --config e2e/playwright.config.ts --project=ui \
		"$SPEC_UI_T2" >"$TRAVAIL/ui-t2.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/ui-t2.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 5 ]; then
			ok "parcours d'interface du retrait — 5 scénarios, clavier et palier 390 px compris"
		else
			fail "parcours d'interface vert mais ${passes:-0} scénarios au lieu de 5"
		fi
	else
		fail_journal "le parcours d'interface du retrait ÉCHOUE" "$TRAVAIL/ui-t2.log"
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
	# LA SUITE QUI DOIT ROUGIR EST UN PARAMÈTRE, et c'est la tranche 2 qui l'a exigé : ses
	# dégradations portent sur `unclassify_message`, que la suite `0027` n'exerce pas. Codée en
	# dur, la suite aurait rendu ces dégradations « NON VUES » alors qu'elles mordent — un harnais
	# complaisant sur le geste le plus récent.
	degradation_sql() {
		local libelle=$1 casser=$2 reparer=$3 suite=${4:-$TEST_SQL}
		if ! psql_db -c "$casser" >"$TRAVAIL/degradation.log" 2>&1; then
			fail_journal "dégradation IMPOSSIBLE À APPLIQUER : $libelle" "$TRAVAIL/degradation.log"
			return
		fi
		if npm run test:sql -- "$suite" >"$TRAVAIL/degrade.log" 2>&1; then
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

	# ------------------------------------------------------------------------------------------
	# LES DÉGRADATIONS DE LA TRANCHE 2, et chacune porte sur une règle du §16.5.
	# ------------------------------------------------------------------------------------------
	# CELLE QUI MANQUE, ET LE MOTIF EST LE MÊME QU'AU CLASSEMENT : retirer `mail_unclassified` du
	# `CHECK` échoue dès qu'une ligne le porte, et `card_events` n'accorde AUCUNE suppression, à
	# personne (`CRM-044`). Une dégradation impossible à appliquer ne prouve rien. Les deux
	# ci-dessous portent donc sur le CORPS de la fonction, où la suite `0066` mesure au même endroit.

	degradation_sql "la symétrie des droits rompue — on retirerait ce qu'on n'aurait pas pu poser" \
		"create or replace function public.unclassify_message(p_message_id uuid)
		 returns uuid language plpgsql security definer set search_path = '' as \$fn\$
		 declare v_message public.mail_messages%rowtype;
		 begin
		   if (select auth.uid()) is null then
		     raise exception 'not_authenticated' using errcode = '42501';
		   end if;
		   select * into v_message from public.mail_messages m where m.id = p_message_id;
		   if v_message.id is null then
		     raise exception 'message_not_found' using errcode = 'P0002';
		   end if;
		   if v_message.card_id is null then return null; end if;
		   if not app.can_write_card(v_message.card_id) then
		     raise exception 'forbidden' using errcode = '42501';
		   end if;
		   update public.mail_messages m set card_id = null, classification = 'unclassified',
		          classified_by = null, classified_at = null where m.id = p_message_id;
		   update public.mail_attachments a set card_id = null where a.message_id = p_message_id;
		   perform app.card_event_ecrire(v_message.card_id, v_message.workspace_id,
		     'mail_unclassified',
		     jsonb_build_object('message_id', p_message_id, 'subject', v_message.subject));
		   return v_message.card_id;
		 end \$fn\$" \
		"$(sed -n '/^create or replace function public.unclassify_message/,/^\\$\\$;$/p' \
		   supabase/migrations/0070_declassement_messages.sql)" \
		"$TEST_SQL_T2"

	degradation_sql "le départ non écrit — la timeline désignerait un message qui n'y est plus" \
		"create or replace function public.unclassify_message(p_message_id uuid)
		 returns uuid language plpgsql security definer set search_path = '' as \$fn\$
		 declare v_message public.mail_messages%rowtype;
		 begin
		   if (select auth.uid()) is null then
		     raise exception 'not_authenticated' using errcode = '42501';
		   end if;
		   select * into v_message from public.mail_messages m where m.id = p_message_id;
		   if v_message.id is null then
		     raise exception 'message_not_found' using errcode = 'P0002';
		   end if;
		   if not app.peut_voir_message(p_message_id) then
		     raise exception 'forbidden' using errcode = '42501';
		   end if;
		   if v_message.card_id is null then return null; end if;
		   if not app.can_write_card(v_message.card_id) then
		     raise exception 'forbidden' using errcode = '42501';
		   end if;
		   update public.mail_messages m set card_id = null, classification = 'unclassified',
		          classified_by = null, classified_at = null where m.id = p_message_id;
		   update public.mail_attachments a set card_id = null where a.message_id = p_message_id;
		   return v_message.card_id;
		 end \$fn\$" \
		"$(sed -n '/^create or replace function public.unclassify_message/,/^\\$\\$;$/p' \
		   supabase/migrations/0070_declassement_messages.sql)" \
		"$TEST_SQL_T2"

	titre "6. Restauration"
	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/restaure.log" 2>&1; then
		ok "la suite pgTAP du classement redevient verte après restauration"
	else
		fail_journal "la suite pgTAP du classement reste ROUGE après restauration" "$TRAVAIL/restaure.log"
	fi
	# LES DEUX SUITES SONT REJOUÉES, et pas seulement celle de la tranche 1 : les dégradations du
	# déclassement remplacent une fonction que `0027` n'exerce pas, si bien qu'une restauration
	# fautive y serait passée inaperçue et aurait laissé le dépôt affaibli en sortant — le défaut
	# exact de la décision 108, dont ce fichier porte déjà une occurrence.
	if npm run test:sql -- "$TEST_SQL_T2" >"$TRAVAIL/restaure-t2.log" 2>&1; then
		ok "la suite pgTAP du déclassement redevient verte après restauration"
	else
		fail_journal "la suite pgTAP du déclassement reste ROUGE après restauration" "$TRAVAIL/restaure-t2.log"
	fi
fi

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%s contrôles, %s en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
