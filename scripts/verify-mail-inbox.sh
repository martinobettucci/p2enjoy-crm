#!/usr/bin/env bash
# @verifies CRM-057 (docs/BACKLOG.md) — Definition of Done de l'inbox globale
# @verifies docs/SPEC-mail-subsystem.md §18.1 (qui voit un non classé), §18.2 (classer exige les
#           deux droits), §18.3 (les trois panneaux), §18.4 (jamais le HTML d'un expéditeur),
#           §18.5 (la pièce saine, et elle seule)
# @verifies docs/SPEC-permissions-rls.md §5, §7.2 preuve de refus n° 9 RÉVISÉE
# @verifies docs/SPEC-seed.md §2.19 ; docs/JOURNAL.md décision 327 ; CLAUDE.md §16
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les fichiers livrés portent leur traçabilité ;
#   2. les fonctions, les politiques et la garde de classement sont RÉELLEMENT en base ;
#   3. le seed a fait arriver deux vrais messages, l'un classé, l'autre non ;
#   4. les preuves dédiées sont vertes — pgTAP, contrat d'API hors interface, parcours d'écran au
#      clavier et à la souris, captures aux quatre paliers ;
#   5. le harnais est NON COMPLAISANT, témoin compris : quatre dégradations réelles doivent le
#      faire échouer.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# AUCUN ENVOI depuis l'inbox : répondre appartient à `CRM-058`. L'écran montre le courrier reçu.
#
# AUCUN RENDU HTML : le corps affiché est du texte, et l'absence est FIGÉE par une preuve, non
# commentée. Un rendu confiné exige un bac à sable et ses propres preuves.
#
# AUCUN RÔLE DE TRI : un membre ordinaire ne voit aucun message non classé. L'absence est figée
# par une assertion pgTAP et par un scénario d'API.
#
# Usage :
#   scripts/verify-mail-inbox.sh
#   scripts/verify-mail-inbox.sh --rapide   n'exécute ni Playwright ni Vitest

set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

MIGRATION=supabase/migrations/0028_inbox_visibilite.sql
MIGRATION_STOCKAGE=supabase/migrations/0029_pieces_jointes_telechargeables.sql
TEST_SQL=supabase/tests/0029_inbox_globale.test.sql
SPEC_API=e2e/api/inbox.spec.ts
SPEC_UI=e2e/ui/inbox.spec.ts
MODULE=webapp/src/lib/inbox.ts
TEST_MODULE=webapp/src/lib/inbox.test.ts
ECRAN=webapp/src/app/RouteInbox.tsx
CAPTURES=docs/captures/CRM-057
DB_CONTAINER=p2enjoy-db

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,33p' "$0"; exit 0 ;;
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
RAPPORTS=e2e/output/verify-mail-inbox
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

printf '\033[1mPreuves de CRM-057 — inbox globale\033[0m\n'

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MIGRATION" "$MIGRATION_STOCKAGE" "$TEST_SQL" "$SPEC_API" "$SPEC_UI" \
	"$MODULE" "$TEST_MODULE" "$ECRAN"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done
for fichier in "$MIGRATION" "$MIGRATION_STOCKAGE" "$MODULE" "$ECRAN"; do
	if head -3 "$fichier" | grep -q 'CRM-057'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité"
	fi
done
for fichier in "$TEST_SQL" "$SPEC_API" "$SPEC_UI" "$TEST_MODULE"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-057'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité"
	fi
done

# LA MIGRATION DE STOCKAGE DÉCLARE SON RÔLE, et c'est la seule façon dont elle puisse s'appliquer :
# `storage.objects` appartient à `supabase_storage_admin`, dont `postgres` n'est pas membre.
if grep -q '^-- @migration-role: supabase_admin' "$MIGRATION_STOCKAGE"; then
	ok "la migration de stockage déclare son rôle d'application"
else
	fail "la migration de stockage ne déclare pas @migration-role : elle échouerait au rejeu"
fi

titre "2. Ce qui est RÉELLEMENT en base"

for fonction in boite_du_message_lisible peut_voir_message piece_jointe_telechargeable; do
	if [ "$(psql_db -c "select count(*) from pg_proc where pronamespace='app'::regnamespace
		and proname='$fonction'")" = 1 ]; then
		ok "app.$fonction est livrée"
	else
		fail "app.$fonction est ABSENTE ou dupliquée"
	fi
done

if [ "$(psql_db -c "select count(*) from pg_proc where pronamespace='public'::regnamespace
	and proname='inbox_arborescence'")" = 1 ]; then
	ok "public.inbox_arborescence est livrée"
else
	fail "public.inbox_arborescence est ABSENTE"
fi

# `SECURITY INVOKER` : les compteurs suivent la RLS de l'appelant. Une fonction `DEFINER` aurait
# annoncé du courrier introuvable à qui n'y a pas droit.
if [ "$(psql_db -c "select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
	where n.nspname='public' and p.proname='inbox_arborescence'")" = f ]; then
	ok "l'arborescence s'exécute avec les droits de l'APPELANT"
else
	fail "l'arborescence s'exécute avec les droits du définisseur : elle annoncerait du courrier
        que l'appelant ne peut pas lire"
fi

# LA GARDE DE CLASSEMENT — le défaut du §18.2, bouché.
if psql_db -c "select prosrc from pg_proc where proname='classify_message'" \
	| grep -q 'peut_voir_message'; then
	ok "classify_message exige de VOIR le message, en plus d'écrire dans la card"
else
	fail "classify_message ne vérifie que le droit d'écriture : un membre pourrait classer chez lui
        un message qu'il n'a pas le droit de lire, puis le lire"
fi

if [ "$(psql_db -c "select count(*) from pg_policies where schemaname='storage'
	and tablename='objects'")" = 1 ]; then
	ok "storage.objects porte EXACTEMENT une politique"
else
	fail "storage.objects porte un nombre inattendu de politiques : ouvrir large ouvrirait tout
        le stockage"
fi

if psql_db -c "select qual from pg_policies where schemaname='storage' and tablename='objects'" \
	| grep -q "mail-attachments"; then
	ok "et elle est bornée au bucket des pièces jointes"
else
	fail "la politique de stockage n'est pas bornée au bucket"
fi

if psql_db -c "select qual from pg_policies where schemaname='public'
	and tablename='mail_attachments'" | grep -q 'peut_voir_message'; then
	ok "la pièce jointe suit son MESSAGE, non une card nulle tant qu'il n'est pas classé"
else
	fail "la pièce jointe suit encore sa card : celle d'un non classé serait invisible à tous"
fi

titre "3. Le courrier du seed — docs/SPEC-seed.md §2.19"

# TÉMOIN AVANT TOUT REFUS : « personne ne voit » est vrai aussi quand il n'y a rien à voir.
if [ "$(psql_db -c "select count(*) from public.mail_messages
	where rfc822_message_id in ('<seed-inbox-classe@p2enjoy.test>',
	                            '<seed-inbox-non-classe@p2enjoy.test>')")" = 2 ]; then
	ok "témoin : les deux messages du seed sont arrivés en base"
else
	fail "les deux messages du seed manquent — l'inbox serait vide et les preuves sans objet.
        Rejouez supabase/seed/apply-seed.sh"
fi

if [ "$(psql_db -c "select classification from public.mail_messages
	where rfc822_message_id = '<seed-inbox-classe@p2enjoy.test>'")" = auto ]; then
	ok "l'un est classé AUTOMATIQUEMENT par la règle 1 — rien n'est forcé en base"
else
	fail "le message adressé à une card n'est pas classé `auto`"
fi

if [ "$(psql_db -c "select classification from public.mail_messages
	where rfc822_message_id = '<seed-inbox-non-classe@p2enjoy.test>'")" = unclassified ]; then
	ok "l'autre reste NON CLASSÉ : le panneau de tri a de quoi se démontrer"
else
	fail "le message adressé à la seule boîte système n'est pas `unclassified`"
fi

titre "4. Ce que l'écran ne fait JAMAIS"

# LE HTML D'UN EXPÉDITEUR N'ATTEINT PAS LE DOM. La règle est vérifiée sur le CODE autant que par
# les tests : un `dangerouslySetInnerHTML` introduit un jour dans cet écran serait une porte
# ouverte aux scripts, aux images distantes et au pistage à l'ouverture.
# LE MOTIF PORTE SON `=` : sans lui, le commentaire qui explique l'interdiction déclencherait
# l'alerte, et le contrôle mesurerait sa propre documentation.
if grep -rq 'dangerouslySetInnerHTML=' "$ECRAN" "$MODULE"; then
	fail "l'inbox injecte du HTML dans le DOM : le §18.4 l'interdit"
else
	ok "aucun `dangerouslySetInnerHTML` : le corps affiché est du texte"
fi

if grep -q 'body_html' "$MODULE"; then
	ok "le HTML est LU — pour être réduit en texte, non pour être rendu"
else
	fail "le module ne lit plus `body_html` : un message qui n'a que du HTML serait affiché vide"
fi

titre "5. Captures observées aux quatre paliers"

for palier in xl-1440 lg-1152 md-900 sm-390; do
	if [ -f "$CAPTURES/inbox-$palier.jpg" ]; then
		ok "capture $palier livrée"
	else
		fail "capture $palier ABSENTE : la Definition of Done exige les quatre paliers"
	fi
done

titre "6. Les preuves dédiées"

if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -f - < "$TEST_SQL" \
	>"$TRAVAIL/pgtap.log" 2>&1 && ! grep -q '^ *not ok' "$TRAVAIL/pgtap.log"; then
	ok "pgTAP $TEST_SQL : $(grep -c ' ok [0-9]' "$TRAVAIL/pgtap.log") assertions vertes"
else
	fail_journal "pgTAP ÉCHOUE" "$TRAVAIL/pgtap.log"
fi

if [ "$RAPIDE" = true ]; then
	titre "7. Preuves longues"
	ok "--rapide : Playwright et Vitest ne sont pas exécutés (annoncé, non masqué)"
else
	titre "7. Vitest, API et écran"

	if npm run test:unit -- --run inbox >"$TRAVAIL/vitest.log" 2>&1; then
		ok "vitest $TEST_MODULE : $(grep -oE 'Tests +[0-9]+ passed' "$TRAVAIL/vitest.log" | tail -1)"
	else
		fail_journal "vitest ÉCHOUE" "$TRAVAIL/vitest.log"
	fi

	if npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
		>"$TRAVAIL/api.log" 2>&1; then
		ok "e2e api : $(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1) hors interface"
	else
		fail_journal "les preuves d'API ÉCHOUENT" "$TRAVAIL/api.log"
	fi

	if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
		>"$TRAVAIL/ui.log" 2>&1; then
		ok "e2e ui : $(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -1) au clavier et à la souris"
	else
		fail_journal "le parcours d'écran ÉCHOUE" "$TRAVAIL/ui.log"
	fi

	titre "8. Non-complaisance"

	if npm run test:unit -- --run inbox >"$TRAVAIL/temoin.log" 2>&1; then
		ok "témoin : les preuves du module sont VERTES avant toute dégradation"
	else
		fail_journal "témoin ROUGE : la suite ne mesure plus rien" "$TRAVAIL/temoin.log"
	fi

	degrader_module() {
		local libelle=$1 motif=$2 remplacement=$3
		sauvegarder "$MODULE"
		if ! sed -i "s|$motif|$remplacement|" "$MODULE" || ! grep -qF "$remplacement" "$MODULE"; then
			# UNE DÉGRADATION QUI NE S'APPLIQUE PAS EST UN ÉCHEC, non un silence : le contrôle
			# suivant serait vert pour la mauvaise raison.
			fail "dégradation INAPPLICABLE : $libelle"
			rendre "$MODULE"
			return
		fi
		if npm run test:unit -- --run inbox >"$TRAVAIL/degrade.log" 2>&1; then
			fail "dégradation NON VUE : $libelle"
		else
			ok "dégradation vue : $libelle"
		fi
		rendre "$MODULE"
	}

	# LE CŒUR DE LA SÉCURITÉ DE L'ÉCRAN : si la réduction laisse passer les balises, le HTML d'un
	# expéditeur revient dans le corps affiché.
	# LES DEUX RETRAITS SONT NEUTRALISÉS PAR LEUR NOM : l'expression est remplacée par une qui ne
	# reconnaît jamais rien, plutôt que retirée de la chaîne d'appels — le code reste valide, et
	# c'est bien la GARANTIE qui tombe, non la compilation.
	degrader_module "les balises ne sont plus retirées — le HTML reviendrait dans le corps" \
		"const BALISES = .*" "const BALISES = /(?!)/g"

	degrader_module "les scripts ne sont plus retirés — du code au fil du courrier" \
		"const SCRIPTS_ET_STYLES = .*" "const SCRIPTS_ET_STYLES = /(?!)/g"

	degrader_module "l'ordre du fil inversé — le plus ancien passerait devant" \
		"ascending: false" "ascending: true"

	degrader_module "la troncature tue — l'écran laisserait croire qu'il montre tout" \
		"messages.length === MESSAGES_PAR_PAGE" "false"

	titre "9. Restauration"
	if npm run test:unit -- --run inbox >"$TRAVAIL/restaure.log" 2>&1; then
		ok "les preuves du module redeviennent vertes après restauration"
	else
		fail_journal "les preuves restent ROUGES après restauration" "$TRAVAIL/restaure.log"
	fi
fi

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%s contrôles, %s en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
