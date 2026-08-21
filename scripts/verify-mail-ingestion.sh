#!/usr/bin/env bash
# @verifies CRM-054 (docs/BACKLOG.md) — Definition of Done de l'ingestion
# @verifies docs/SPEC-mail-subsystem.md §4.1 (boucle), §4.2 (dédoublonnage et occurrences),
#           §4.3 (pièces jointes et statuts), §15.1 (mesures), §15.3 (empreinte de repli),
#           §15.4 (dossiers surveillés), §15.5 (dépôt puis analyse), §15.6 (preuves exigées)
# @verifies docs/SPEC-permissions-rls.md §7, preuve de refus n° 9
# @verifies docs/JOURNAL.md décision 320 ; CLAUDE.md §8 (aucune trace fabriquée)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les fichiers livrés portent leur traçabilité ;
#   2. les trois tables et le bucket sont réellement en base, et le bucket est PRIVÉ ;
#   3. aucune politique de lecture d'objet n'existe — c'est ce qui tient la preuve n° 9 ;
#   4. le seed surveille les DEUX dossiers, ce que la mesure du §15.4 impose ;
#   5. les preuves dédiées sont vertes : pgTAP, API, `mail` avec un email réellement envoyé ;
#   6. `pytest` couvre l'analyse MIME, l'empreinte de repli et l'antivirus ;
#   7. le harnais est NON COMPLAISANT, témoin compris.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# AUCUN CLASSEMENT : un message ingéré est `unclassified`, et les quatre règles du §4.4
# appartiennent à `CRM-055`. Le harnais échoue si un message classé apparaissait sans elles.
#
# AUCUN DOSSIER IMAP CRÉÉ (`CRM-056`), AUCUN ÉCRAN (`CRM-057`), AUCUN ENVOI (`CRM-058`), AUCUNE
# VEILLE PERMANENTE : la relève est déclenchée par l'API interne, et `CRM-059` porte la résilience.
#
# Usage :
#   scripts/verify-mail-ingestion.sh
#   scripts/verify-mail-ingestion.sh --rapide   n'exécute ni Playwright ni pytest

set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

RACINE=$PWD
MIGRATION=supabase/migrations/0024_ingestion_messages.sql
TEST_SQL=supabase/tests/0026_ingestion_messages.test.sql
SPEC_API=e2e/api/ingestion.spec.ts
SPEC_MAIL=e2e/mail/ingestion.spec.ts
MIME=mail-sync/src/mail_sync/mime_analyse.py
ANTIVIRUS=mail-sync/src/mail_sync/antivirus.py
INGESTION=mail-sync/src/mail_sync/ingestion.py
DB_CONTAINER=p2enjoy-db

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,32p' "$0"; exit 0 ;;
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
RAPPORTS=e2e/output/verify-mail-ingestion
mkdir -p "$RAPPORTS"
fail_journal() {
	local message=$1 journal=$2
	cp "$journal" "$RAPPORTS/$(basename "$journal")" 2>/dev/null || true
	fail "$message — voir $RAPPORTS/$(basename "$journal")"
	tail -n 25 "$journal" | sed 's/^/        /'
}
SAUVEGARDES="$TRAVAIL/sauvegardes"; mkdir -p "$SAUVEGARDES"
sauvegarder() { cp "$1" "$SAUVEGARDES/$(printf '%s' "$1" | tr '/' '@')"; }
rendre() { cp "$SAUVEGARDES/$(printf '%s' "$1" | tr '/' '@')" "$1"; }
restaurer() {
	for fichier in "$SAUVEGARDES"/*; do
		[ -e "$fichier" ] || continue
		cp "$fichier" "$(basename "$fichier" | tr '@' '/')"
	done
	rm -rf "$TRAVAIL"
}
trap restaurer EXIT

printf '\033[1mPreuves de CRM-054 — ingestion des messages\033[0m\n'

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MIGRATION" "$TEST_SQL" "$SPEC_API" "$SPEC_MAIL" "$MIME" "$ANTIVIRUS" "$INGESTION"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

for fichier in "$MIGRATION" "$MIME" "$ANTIVIRUS" "$INGESTION"; do
	if head -3 "$fichier" | grep -q '@spec CRM-054'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

for fichier in "$TEST_SQL" "$SPEC_API" "$SPEC_MAIL"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-054'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

titre "2. Le schéma réellement en base"

for table in mail_messages mail_message_occurrences mail_attachments; do
	if [ "$(psql_db -c "select to_regclass('public.$table') is not null")" = t ]; then
		ok "la table $table existe"
	else
		fail "la table $table est ABSENTE"
	fi
done

if [ "$(psql_db -c "select public from storage.buckets where id='mail-attachments'")" = f ]; then
	ok "le bucket des pièces jointes existe, et il est PRIVÉ"
else
	fail "le bucket est absent ou PUBLIC — la preuve n° 9 tomberait"
fi

# RETOURNÉE LE 2026-08-21 — INC-191, décision 497, TROISIÈME OCCURRENCE DANS CE FICHIER et la
# première à être nommée. Cette assertion figeait elle aussi une absence : « aucune politique de
# lecture d'objet, donc la RLS refuse par défaut ». C'était vrai, et c'était le refus n° 9 obtenu
# par le vide. La migration `0029_pieces_jointes_telechargeables.sql` a livré depuis la politique
# `mail_attachments_objets_lecture` — MESURÉ le 2026-08-21, elle existe, en `SELECT`, pour
# `authenticated` — de sorte que le harnais rougissait d'une fonctionnalité livrée, en annonçant
# « le téléchargement d'une pièce infected est possible » alors que c'est le CONTRAIRE que la
# politique tient : elle est gardée par `app.piece_jointe_telechargeable(name)`, qui refuse
# précisément `infected` et `pending`.
#
# Le refus n° 9 ne repose donc plus sur le vide, et l'assertion cesse de compter des politiques pour
# mesurer ce que la seule politique admise autorise. Elle n'est pas retirée, elle est retournée.
politiques=$(psql_db -c "select coalesce(string_agg(policyname || ':' || cmd, ',' order by policyname), '')
	from pg_policies where schemaname='storage' and tablename='objects'")
if [ "$politiques" = "mail_attachments_objets_lecture:SELECT" ]; then
	ok "une SEULE politique d'objet, en lecture : \`mail_attachments_objets_lecture\` — aucune écriture n'est ouverte sur \`storage.objects\`"
else
	fail "les politiques de \`storage.objects\` ne sont plus la seule lecture attendue : « $politiques »"
fi

if [ "$(psql_db -c "select qual like '%piece_jointe_telechargeable%' and qual like '%mail-attachments%'
	from pg_policies where schemaname='storage' and tablename='objects'
	  and policyname='mail_attachments_objets_lecture'")" = t ]; then
	ok "REFUS N° 9 : la lecture d'objet est bornée au bucket \`mail-attachments\` ET gardée par \`app.piece_jointe_telechargeable\`"
else
	fail "la politique de lecture d'objet n'est plus gardée par \`app.piece_jointe_telechargeable\` : une pièce infected redeviendrait servie"
fi

# ET LA GARDE PORTE SES DEUX MEMBRES, car citer le nom de la fonction dans la politique ne dit rien
# de ce que la fonction fait : celle-ci n'ouvre que le statut `clean` — `pending`, `skipped` et
# `infected` sont refusés, un fichier non analysé n'étant pas un fichier sain — ET ne l'ouvre qu'à
# qui peut déjà voir le message. Perdre l'un des deux rouvrirait la porte en silence.
definition=$(psql_db -c "select pg_get_functiondef(oid) from pg_proc
	where pronamespace = 'app'::regnamespace and proname = 'piece_jointe_telechargeable'")
case "$definition" in
	*"av_status = 'clean'"*"peut_voir_message"*)
		ok "\`app.piece_jointe_telechargeable\` n'ouvre que \`clean\` ET seulement à qui voit le message : \`pending\`, \`skipped\` et \`infected\` restent refusés" ;;
	*)
		fail "\`app.piece_jointe_telechargeable\` a perdu l'un de ses deux membres : statut sain, ou visibilité du message" ;;
esac

# CE QUE CE HARNAIS NE PROUVE PAS ICI, ET IL LE DIT. Les trois contrôles ci-dessus mesurent la
# STRUCTURE du refus n° 9. Son COMPORTEMENT — un téléchargement réellement refusé avec les jetons
# réels — est éprouvé par `e2e/api/ingestion.spec.ts`, `supabase/tests/0016_preuves_refus.test.sql`
# et `scripts/verify-preuves-refus.sh`. Le rejouer ici ferait deux sources pour une même règle.

nb_ecriture=$(psql_db -c "select count(*) from information_schema.role_table_grants
	where table_schema='public'
	  and table_name in ('mail_messages','mail_message_occurrences','mail_attachments')
	  and grantee='authenticated' and privilege_type <> 'SELECT'")
if [ "$nb_ecriture" = 0 ]; then
	ok "aucune écriture accordée à authenticated : un message est un FAIT reçu"
else
	fail "$nb_ecriture privilège(s) d'écriture accordé(s) sur l'ingestion"
fi

titre "3. Le seed et ce qu'il surveille"

# LA MESURE DU §15.4 : un message externe non authentifié est classé indésirable. Un compte qui ne
# surveillerait que INBOX ne verrait jamais arriver ce courrier.
if [ "$(psql_db -c "select count(*) from public.mail_inbound_accounts
	where 'Junk Mail' = any(watch_folders) and 'INBOX' = any(watch_folders)")" = 3 ]; then
	ok "les trois comptes seedés surveillent INBOX ET Junk Mail — §15.4"
else
	fail "les comptes seedés ne surveillent pas les deux dossiers : la relève serait aveugle"
fi

# RETOURNÉE LE 2026-08-21 — INC-191, décision 497. Cette assertion figeait une ABSENCE : « aucun
# message n'est classé », vraie tant que `CRM-055` n'était pas livrée. Elle l'est, et son classement
# tourne : MESURÉ le 2026-08-21, deux messages portent `auto`. Le harnais rougissait donc de la
# livraison qu'il annonçait attendre — c'est exactement le moment que l'assertion devait désigner.
#
# Elle est RETOURNÉE, non retirée (mécanisme de la décision 51), et ce qu'elle mesure change de
# nature : `CRM-054` ingère, elle ne classe pas. Ce qui doit rester vrai de l'INGESTION est qu'elle
# ne fabrique aucun classement de son côté — un message classé porte donc toujours la trace du
# geste qui l'a classé, jamais un classement apparu de nulle part. Le détail des quatre règles du
# §4.4 reste sous `CRM-055` et son propre harnais ; ici, seule la frontière entre les deux unités
# est éprouvée.
sans_trace=$(psql_db -c "select count(*) from public.mail_messages
	where classification <> 'unclassified' and classified_at is null")
if [ "$sans_trace" = 0 ]; then
	classes=$(psql_db -c "select count(*) from public.mail_messages where classification <> 'unclassified'")
	ok "les $classes message(s) classé(s) portent tous la trace de leur classement : l'ingestion n'en fabrique aucun — la frontière CRM-054 / CRM-055 tient"
else
	fail "$sans_trace message(s) classé(s) SANS \`classified_at\` : un classement est apparu hors du chemin de CRM-055"
fi

# LE TÉMOIN, sans lequel le contrôle ci-dessus serait vert sur une base où plus rien n'est classé.
if [ "$(psql_db -c "select count(*) from public.mail_messages where classification = 'unclassified'")" -ge 1 ]; then
	ok "des messages restent \`unclassified\` : l'ingestion dépose bien sans classer, et le contrôle précédent a un objet"
else
	fail "plus aucun message \`unclassified\` : l'ingestion ne dépose plus de message non classé"
fi

if [ "$RAPIDE" = false ]; then
	titre "4. Preuves exécutables"

	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/pgtap.log" 2>&1; then
		assertions=$(grep -oE '[0-9]+ assertions' "$TRAVAIL/pgtap.log" | head -1 | grep -oE '[0-9]+')
		if [ "${assertions:-0}" -eq 26 ]; then
			ok "suite pgTAP dédiée — 26 assertions"
		else
			fail "suite pgTAP verte mais ${assertions:-0} assertions au lieu de 26"
		fi
	else
		fail_journal "la suite pgTAP dédiée ÉCHOUE" "$TRAVAIL/pgtap.log"
	fi

	if E2E_PROJETS=api npx playwright test --config e2e/playwright.config.ts --project=api \
		"$SPEC_API" >"$TRAVAIL/api.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 4 ]; then
			ok "preuve d'API dédiée — 4 scénarios, refus n° 9 compris"
		else
			fail "preuve d'API verte mais ${passes:-0} scénarios au lieu de 4"
		fi
	else
		fail_journal "la preuve d'API ÉCHOUE" "$TRAVAIL/api.log"
	fi

	if E2E_PROJETS=mail npx playwright test --config e2e/playwright.config.ts --project=mail \
		"$SPEC_MAIL" >"$TRAVAIL/mail.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/mail.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 2 ]; then
			ok "preuve mail — un email RÉELLEMENT envoyé, relevé, analysé, et rejoué sans doublon"
		else
			fail "preuve mail verte mais ${passes:-0} scénarios au lieu de 2"
		fi
	else
		fail_journal "la preuve mail ÉCHOUE" "$TRAVAIL/mail.log"
	fi

	if [ -x "$RACINE/.venv/bin/python" ]; then PYTHON=$RACINE/.venv/bin/python; else PYTHON=python3; fi
	if "$PYTHON" -m pytest "$RACINE/mail-sync/tests" -q >"$TRAVAIL/pytest.log" 2>&1; then
		ok "pytest mail-sync/tests : $(tail -1 "$TRAVAIL/pytest.log")"
	else
		fail_journal "pytest ÉCHOUE" "$TRAVAIL/pytest.log"
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

	degradation_sql "le bucket rendu PUBLIC — toute pièce serait servie, infected comprise" \
		"update storage.buckets set public = true where id='mail-attachments'" \
		"update storage.buckets set public = false where id='mail-attachments'"

	degradation_sql "la clé de dédoublonnage retirée — chaque relève dupliquerait les messages" \
		"alter table public.mail_messages drop constraint mail_messages_dedoublonnage" \
		"alter table public.mail_messages add constraint mail_messages_dedoublonnage
		 unique (workspace_id, rfc822_message_id)"

	degradation_sql "la borne du chemin de dépôt retirée — un nom de fichier y reviendrait" \
		"alter table public.mail_attachments drop constraint mail_attachments_chemin_sans_nom" \
		"alter table public.mail_attachments add constraint mail_attachments_chemin_sans_nom
		 check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}\$')"

	degradation_sql "l'écriture rendue à authenticated — un message cesserait d'être un fait reçu" \
		"grant insert on public.mail_messages to authenticated" \
		"revoke insert on public.mail_messages from authenticated"

	# LA SONDE ANTIVIRUS DÉGRADÉE : une panne d'antivirus ne doit JAMAIS rendre `clean`.
	sauvegarder "$ANTIVIRUS"
	sed -i 's/^        return VerdictAntivirus(statut=SKIPPED)$/        return VerdictAntivirus(statut=CLEAN)/' "$ANTIVIRUS"
	if "$PYTHON" -m pytest "$RACINE/mail-sync/tests/test_antivirus.py" -q >"$TRAVAIL/degrade-av.log" 2>&1; then
		fail "dégradation NON VUE : un antivirus injoignable rendrait le statut sain"
	else
		ok "dégradation vue : un antivirus injoignable ne peut pas rendre le statut sain"
	fi
	rendre "$ANTIVIRUS"

	# L'EMPREINTE DE REPLI SANS SÉPARATEUR : deux messages différents auraient la même.
	sauvegarder "$MIME"
	sed -i 's/    brut = "\\x00".join(composantes).encode("utf-8")/    brut = "".join(composantes).encode("utf-8")/' "$MIME"
	if "$PYTHON" -m pytest "$RACINE/mail-sync/tests/test_mime_analyse.py" -q >"$TRAVAIL/degrade-mime.log" 2>&1; then
		fail "dégradation NON VUE : l'empreinte sans séparateur passe les preuves"
	else
		ok "dégradation vue : retirer le séparateur de l'empreinte fait échouer pytest"
	fi
	rendre "$MIME"

	titre "6. Restauration"

	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/restaure.log" 2>&1; then
		ok "la suite pgTAP redevient verte après restauration"
	else
		fail_journal "la suite pgTAP reste ROUGE après restauration" "$TRAVAIL/restaure.log"
	fi
	if "$PYTHON" -m pytest "$RACINE/mail-sync/tests" -q >"$TRAVAIL/restaure-py.log" 2>&1; then
		ok "pytest redevient vert après restauration"
	else
		fail_journal "pytest reste ROUGE après restauration" "$TRAVAIL/restaure-py.log"
	fi
fi

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%s contrôles, %s en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
