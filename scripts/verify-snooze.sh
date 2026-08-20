#!/usr/bin/env bash
# @verifies CRM-081 (docs/BACKLOG.md) — Definition of Done de la mise en sommeil des affaires et
#           des fils de messagerie ; c'est le dernier travail que le backlog nomme sur cette unité
# @verifies docs/SPEC-cards.md §16 bis (contrat de CE harnais), §16.2 (ce que « en sommeil »
#           signifie), §16.5 (la trace est écrite par un trigger), §16.7 (la colonne se ferme),
#           §16.10 (les deux états que le seed doit démontrer), §16.12.1 et §16.12.4 (le filtre et
#           son défaut), §16.14.6 (qui lit la ligne du fil), §16.15.2 (`cleFil`, deux langages)
# @verifies docs/SPEC-test-harness.md §1 (un harnais qui rend vert sans rien exercer est pire
#           qu'une commande absente), §7.1 (chaîne Node Linux), §7.2 point 9 (restauration
#           constatée octet à octet, jamais comparée à HEAD)
# @verifies CLAUDE.md §16 (vérification visuelle), §17 (Definition of Done), §25 (ne jamais
#           annoncer une preuve non exécutée)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les vingt fichiers livrés portent leur traçabilité ;
#   2. les quatre gestes, la colonne FERMÉE, le vocabulaire à quatorze valeurs, le trigger de
#      trace, la table du fil et ses privilèges sont RÉELLEMENT en base ;
#   3. le seed démontre les DEUX états — une affaire endormie, une affaire dont le sommeil est
#      échu — sans quoi la moitié des scénarios mesurerait un état absent ;
#   4. les captures existent et sont comptées ;
#   5. les preuves dédiées sont vertes, et leurs quatre couples de compteurs sont FIGÉS ;
#   6. le harnais est NON COMPLAISANT, témoin compris : cinq dégradations réelles doivent le faire
#      échouer, et la restauration est constatée octet à octet.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit (docs/SPEC-cards.md §16 bis.5).
# ---------------------------------------------------------------------------------------------
# AUCUNE RÈGLE D'AUTORISATION N'Y EST RÉÉCRITE : les politiques de `cards` sont celles de `CRM-040`.
# AUCUNE CAPTURE N'Y EST OBSERVÉE : les compter n'est pas les regarder, et `CLAUDE.md` §16 confie ce
# geste à l'humain de la session qui les produit.
# LE MODE D'AFFICHAGE DE L'INBOX N'ENTRE PAS DANS L'ADRESSE (§16.15.5, point 3) : écart en attente
# d'arbitrage, délibérément NON figé ici — une assertion en ferait une règle par la bande.
#
# Usage :
#   scripts/verify-snooze.sh
#   scripts/verify-snooze.sh --rapide   n'exécute pas Playwright

set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

RACINE=$PWD
DB_CONTAINER=p2enjoy-db

# Les sept fichiers de CODE de l'unité (§16 bis.3, ligne 1).
CODE=(
	supabase/migrations/0044_snooze_cards.sql
	supabase/migrations/0048_snooze_fils.sql
	webapp/src/lib/sommeil-card.ts
	webapp/src/lib/sommeil-fil.ts
	webapp/src/lib/filtre-sommeil.ts
	webapp/src/lib/fil-inbox.ts
	webapp/src/components/ui/Sommeil.tsx
)

# Les treize fichiers de PREUVE, groupés par famille — les compteurs figés les suivent.
TESTS_SQL=(supabase/tests/0042_snooze_cards.test.sql supabase/tests/0046_snooze_fils.test.sql)
TESTS_UNIT=(
	webapp/src/lib/sommeil-card.test.ts
	webapp/src/lib/sommeil-fil.test.ts
	webapp/src/lib/fil-inbox.test.ts
)
SPECS_API=(e2e/api/snooze.spec.ts e2e/api/filtre-sommeil.spec.ts e2e/api/snooze-fils.spec.ts)
SPECS_UI=(
	e2e/ui/sommeil-card.spec.ts
	e2e/ui/filtre-sommeil.spec.ts
	e2e/ui/menu-sommeil-board.spec.ts
	e2e/ui/sommeil-fil.spec.ts
	e2e/ui/groupement-fils.spec.ts
)

# LES DEUX COMPTEURS DE CHAQUE FAMILLE SONT FIGÉS, jamais un seul (décision 279) : vérifier les
# seules assertions ne détecte pas la disparition d'une suite entière, et vérifier les seuls
# fichiers ne détecte pas la disparition de leur contenu. Un compte qui MONTE est aussi un écart :
# il se constate ici, et le chiffre se met à jour dans le même changement que la preuve ajoutée.
ATTENDU_SQL_ASSERTIONS=67
ATTENDU_UNIT_TESTS=67
ATTENDU_API_SCENARIOS=30
ATTENDU_UI_SCENARIOS=37
CAPTURES=docs/captures/CRM-081
ATTENDU_CAPTURES=47

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,42p' "$0"; exit 0 ;;
		*) echo "option inconnue « $1 ». Voir --help." >&2; exit 1 ;;
	esac
	shift
done

failures=0; checks=0
ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# La fonction rend TOUJOURS 0 et fait du texte de l'erreur la valeur lue : sous `set -euo
# pipefail`, propager le code de `psql` ferait mourir le harnais au premier `select` en erreur, et
# rendrait un code non nul MUET au lieu d'un diagnostic (décision 484, INC du même motif).
psql_db() {
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -c "$1" 2>&1 || true
}

TRAVAIL=$(mktemp -d)
RAPPORTS=e2e/output/verify-snooze
mkdir -p "$RAPPORTS"
fail_journal() {
	local message=$1 journal=$2
	cp "$journal" "$RAPPORTS/$(basename "$journal")" 2>/dev/null || true
	fail "$message — voir $RAPPORTS/$(basename "$journal")"
	tail -n 25 "$journal" | sed 's/^/        /'
}
SAUVEGARDES="$TRAVAIL/sauvegardes"; mkdir -p "$SAUVEGARDES"
empreinte() { printf '%s' "$1" | tr '/' '@'; }
sauvegarder() { [ -e "$SAUVEGARDES/$(empreinte "$1")" ] || cp "$1" "$SAUVEGARDES/$(empreinte "$1")"; }
rendre() { cp "$SAUVEGARDES/$(empreinte "$1")" "$1"; }
restaurer() {
	for fichier in "$SAUVEGARDES"/*; do
		[ -e "$fichier" ] || continue
		cp "$fichier" "$(basename "$fichier" | tr '@' '/')"
	done
	rm -rf "$TRAVAIL"
}
trap restaurer EXIT

printf '\033[1mPreuves de CRM-081 — mise en sommeil des affaires et des fils\033[0m\n'

titre "1. Fichiers livrés et traçabilité"

for fichier in "${CODE[@]}"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done
for fichier in "${CODE[@]}"; do
	if head -3 "$fichier" | grep -q '@spec CRM-081'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité"
	fi
done
for fichier in "${TESTS_SQL[@]}" "${TESTS_UNIT[@]}" "${SPECS_API[@]}" "${SPECS_UI[@]}"; do
	if [ ! -f "$fichier" ]; then
		fail "$fichier est ABSENT"
	elif head -3 "$fichier" | grep -q '@verifies CRM-081'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité"
	fi
done

titre "2. Ce qui est RÉELLEMENT en base"

# Les signatures sont exigées ENTIÈRES : une fonction qui perdrait son argument `until` porterait
# encore son nom, et le contrôle par le seul nom la déclarerait livrée.
verifier_signature() {
	local attendue=$1 nom=${1%%(*}
	if [ "$(psql_db "select count(*) from pg_proc
		where pronamespace='public'::regnamespace and proname='$nom'
		  and proname||'('||pg_get_function_identity_arguments(oid)||')' = '$attendue'")" = 1 ]; then
		ok "$attendue est livrée"
	else
		fail "$attendue est ABSENTE ou sa signature a changé"
	fi
}
verifier_signature 'snooze_card(card_id uuid, until timestamp with time zone)'
verifier_signature 'wake_card(card_id uuid)'
verifier_signature 'snooze_thread(workspace uuid, thread_key text, until timestamp with time zone)'
verifier_signature 'wake_thread(workspace uuid, thread_key text)'

if [ "$(psql_db "select count(*) from pg_proc
	where pronamespace='app'::regnamespace and proname='cle_fil'")" = 1 ]; then
	ok "app.cle_fil est livrée : la clé du fil a une définition SERVEUR"
else
	fail "app.cle_fil est ABSENTE : la clé du client n'aurait plus de pendant"
fi

# LE CONSTAT QUI COÛTERAIT LE PLUS CHER À PERDRE (§16 bis.1) : la colonne rouverte, l'écran
# écrirait une échéance sans passer par la garde, et les quatre refus du §16.3 deviendraient
# contournables sans qu'aucune preuve d'API ne rougisse — elles interrogent les fonctions.
if [ "$(psql_db "select has_column_privilege('authenticated','public.cards','snoozed_until','update')")" = f ]; then
	ok "cards.snoozed_until est FERMÉE en écriture directe : les gestes sont la seule porte"
else
	fail "cards.snoozed_until est réouverte : la garde des quatre refus est contournable"
fi

for evenement in snoozed woken; do
	if psql_db "select pg_get_constraintdef(oid) from pg_constraint
		where conname='card_events_type_check'" | grep -q "'$evenement'"; then
		ok "le vocabulaire du fil connaît « $evenement »"
	else
		fail "« $evenement » a disparu du vocabulaire : la trace ne pourrait plus s'écrire"
	fi
done

if [ "$(psql_db "select count(*) from pg_trigger
	where tgrelid='public.cards'::regclass and tgname='card_events_apres_maj_sommeil'
	  and not tgisinternal")" = 1 ]; then
	ok "la trace est écrite par un trigger de TABLE : une écriture par la clé de service la laisse aussi"
else
	fail "le trigger de trace du sommeil est ABSENT"
fi

if [ "$(psql_db "select to_regclass('public.mail_thread_snoozes') is not null")" = t ]; then
	ok "public.mail_thread_snoozes existe"
else
	fail "public.mail_thread_snoozes est ABSENTE"
fi

if [ "$(psql_db "select relrowsecurity from pg_class
	where oid='public.mail_thread_snoozes'::regclass")" = t ]; then
	ok "la RLS est active sur la table du fil"
else
	fail "la RLS est INACTIVE sur la table du fil : un workspace lirait le sommeil d'un autre"
fi

if [ "$(psql_db "select count(*) from pg_policies
	where schemaname='public' and tablename='mail_thread_snoozes'")" = 1 ]; then
	ok "la table du fil porte sa politique unique de lecture"
else
	fail "le compte de politiques de mail_thread_snoozes a changé"
fi

if [ "$(psql_db "select has_table_privilege('authenticated','public.mail_thread_snoozes','select')")" = t ]; then
	ok "le client LIT la table du fil : la pastille a sa source"
else
	fail "le client ne lit plus la table du fil : la pastille n'aurait plus de source"
fi
for droit in insert update delete; do
	if [ "$(psql_db "select has_table_privilege('authenticated','public.mail_thread_snoozes','$droit')")" = f ]; then
		ok "le client ne peut pas $droit la table du fil : les deux gestes sont la seule porte"
	else
		fail "le client peut $droit la table du fil : la garde de snooze_thread est contournable"
	fi
done

titre "3. Le seed démontre les DEUX états (§16.10)"

# UNE SEULE DES DEUX DISPARAÎTRAIT QUE LA MOITIÉ DES SCÉNARIOS MESURERAIT UN ÉTAT ABSENT : le
# filtre du §16.12 rendrait le même écran dans ses deux modes, et il rendrait VERT.
verifier_compte() {
	local libelle=$1 requete=$2 attendu=$3 mesure
	mesure=$(psql_db "$requete")
	if [ "$mesure" = "$attendu" ]; then
		ok "$libelle : $mesure"
	else
		fail "$libelle : $mesure au lieu de $attendu"
	fi
}
verifier_compte "affaires portant une échéance de sommeil" \
	"select count(*) from public.cards where snoozed_until is not null" 2
verifier_compte "affaires RÉELLEMENT en sommeil (échéance future)" \
	"select count(*) from public.cards where snoozed_until > now()" 1
verifier_compte "affaires dont le sommeil est ÉCHU (§16.2 : le temps seul les réveille)" \
	"select count(*) from public.cards where snoozed_until is not null and snoozed_until <= now()" 1
verifier_compte "fils endormis résiduels (§16.14.7 : les preuves réveillent ce qu'elles endorment)" \
	"select count(*) from public.mail_thread_snoozes" 0

titre "4. Captures (CLAUDE.md §16)"

if [ -d "$CAPTURES" ]; then
	nombre=$(find "$CAPTURES" -type f | wc -l | tr -d ' ')
	if [ "$nombre" = "$ATTENDU_CAPTURES" ]; then
		ok "$CAPTURES porte ses $nombre captures"
	else
		fail "$CAPTURES porte $nombre captures au lieu de $ATTENDU_CAPTURES"
	fi
else
	fail "$CAPTURES est ABSENT"
fi
# Une capture nommée par tranche, pour qu'un dossier au bon COMPTE mais au mauvais CONTENU ne
# passe pas : le total seul ne dirait rien de ce qui a été montré.
for capture in sommeil-fiche-endormie-1440.jpg filtre-sommeil-board-masquees-1440.jpg \
	menu-sommeil-board-endormie-1440.jpg groupement-fil-liste.jpg; do
	if [ -f "$CAPTURES/$capture" ]; then
		ok "capture $capture présente"
	else
		fail "capture $capture ABSENTE"
	fi
done

titre "5. Les preuves dédiées"

total_sql=0
for fichier in "${TESTS_SQL[@]}"; do
	journal="$TRAVAIL/$(basename "$fichier").log"
	if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -f - < "$fichier" \
		>"$journal" 2>&1 && ! grep -q 'not ok' "$journal"; then
		assertions=$(grep -cE ' ok [0-9]+ - ' "$journal")
		total_sql=$((total_sql + assertions))
		ok "pgTAP $(basename "$fichier") : $assertions assertions vertes"
	else
		fail_journal "pgTAP $(basename "$fichier") ÉCHOUE" "$journal"
	fi
done
if [ "$total_sql" = "$ATTENDU_SQL_ASSERTIONS" ]; then
	ok "pgTAP : ${#TESTS_SQL[@]} fichiers, $total_sql assertions — les deux compteurs sont tenus"
else
	fail "pgTAP : $total_sql assertions au lieu de $ATTENDU_SQL_ASSERTIONS"
fi

compter_vitest() {
	local journal=$1
	grep -oE 'Tests +[0-9]+ passed' "$journal" | grep -oE '[0-9]+' | tail -1
}
if npx vitest run "${TESTS_UNIT[@]}" >"$TRAVAIL/vitest.log" 2>&1; then
	tests=$(compter_vitest "$TRAVAIL/vitest.log")
	if [ "$tests" = "$ATTENDU_UNIT_TESTS" ]; then
		ok "Vitest : ${#TESTS_UNIT[@]} fichiers, $tests tests — les deux compteurs sont tenus"
	else
		fail "Vitest : ${tests:-0} tests au lieu de $ATTENDU_UNIT_TESTS"
	fi
else
	fail_journal "les preuves unitaires ÉCHOUENT" "$TRAVAIL/vitest.log"
fi

if [ "$RAPIDE" = true ]; then
	titre "6. Preuves longues"
	ok "--rapide : Playwright n'est pas exécuté (annoncé, non masqué — CLAUDE.md §25)"
else
	titre "6. API et interface, avec les jetons réels"

	if npx playwright test --config e2e/playwright.config.ts --project=api "${SPECS_API[@]}" \
		>"$TRAVAIL/api.log" 2>&1; then
		scenarios=$(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | grep -oE '[0-9]+' | tail -1)
		if [ "$scenarios" = "$ATTENDU_API_SCENARIOS" ]; then
			ok "API : ${#SPECS_API[@]} fichiers, $scenarios scénarios hors interface"
		else
			fail "API : ${scenarios:-0} scénarios au lieu de $ATTENDU_API_SCENARIOS"
		fi
	else
		fail_journal "les preuves d'API ÉCHOUENT" "$TRAVAIL/api.log"
	fi

	if npx playwright test --config e2e/playwright.config.ts --project=ui "${SPECS_UI[@]}" \
		>"$TRAVAIL/ui.log" 2>&1; then
		scenarios=$(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | grep -oE '[0-9]+' | tail -1)
		if [ "$scenarios" = "$ATTENDU_UI_SCENARIOS" ]; then
			ok "UI : ${#SPECS_UI[@]} fichiers, $scenarios scénarios au clavier et à la souris"
		else
			fail "UI : ${scenarios:-0} scénarios au lieu de $ATTENDU_UI_SCENARIOS"
		fi
	else
		fail_journal "les parcours d'interface ÉCHOUENT" "$TRAVAIL/ui.log"
	fi
fi

titre "7. Non-complaisance"

# LE TÉMOIN PASSE AVANT LES DÉGRADATIONS : une suite déjà rouge ferait passer cinq dégradations
# pour des détections, et le harnais rendrait « non complaisant » sans avoir rien établi.
if npx vitest run "${TESTS_UNIT[@]}" >"$TRAVAIL/temoin.log" 2>&1; then
	ok "témoin : les preuves unitaires sont VERTES avant toute dégradation"
else
	fail_journal "témoin ROUGE : les dégradations ne prouveraient plus rien" "$TRAVAIL/temoin.log"
fi

degrader() {
	local libelle=$1 fichier=$2 motif=$3 remplacement=$4
	sauvegarder "$fichier"
	if ! sed -i "s|$motif|$remplacement|" "$fichier" || ! grep -qF "$remplacement" "$fichier"; then
		fail "dégradation INAPPLICABLE : $libelle"
		rendre "$fichier"
		return
	fi
	if npx vitest run "${TESTS_UNIT[@]}" >"$TRAVAIL/degrade.log" 2>&1; then
		fail "dégradation NON VUE : $libelle"
		cp "$TRAVAIL/degrade.log" "$RAPPORTS/degradation-non-vue.log" 2>/dev/null || true
	else
		ok "dégradation vue : $libelle"
	fi
	rendre "$fichier"
}

# 1. Une échéance ÉCHUE deviendrait un sommeil : l'affaire resterait masquée pour toujours, alors
#    que le §16.2 fait de la sortie du sommeil un simple passage du temps.
degrader "l'instant retiré du prédicat — une échéance échue endormirait encore" \
	webapp/src/lib/sommeil-card.ts \
	'return echeance.getTime() > maintenant.getTime()' \
	'return true'

# 2. `not.gt` écarterait TOUTES les affaires qui n'ont jamais dormi : une colonne nulle ne satisfait
#    aucune comparaison, et un channel entier quitterait la vue par défaut.
degrader "le filtre d'exclusion réduit à not.gt — les affaires jamais endormies disparaîtraient" \
	webapp/src/lib/filtre-sommeil.ts \
	'return `snoozed_until.is.null,snoozed_until.lte.\${maintenant.toISOString()}`' \
	'return `snoozed_until.not.gt.${maintenant.toISOString()}`'

# 3. Le défaut inversé : une adresse nue montrerait les affaires endormies, et le sommeil ne
#    changerait plus rien pour l'utilisateur.
degrader "le défaut de la bascule inversé — le sommeil ne rangerait plus rien" \
	webapp/src/lib/filtre-sommeil.ts \
	"return valeur === VALEUR_URL_SOMMEIL_VISIBLES ? 'visibles' : MODE_SOMMEIL_PAR_DEFAUT" \
	"return 'visibles'"

# 4. La clé du client cesserait de coïncider avec celle du serveur : chaque message ferait fil à
#    part, et le refus `thread_not_found` porterait sur une clé que personne n'a affichée.
degrader "la racine des références ignorée par cleFil — client et serveur ne parleraient plus de la même clé" \
	webapp/src/lib/sommeil-fil.ts \
	'return racine === undefined ? rfc822MessageId : racine' \
	'return rfc822MessageId'

# 5. Le refus d'une échéance passée retomberait en `inconnu` : le geste paraîtrait cassé au lieu
#    d'être guidé.
degrader "le refus d'échéance passée retombé en « inconnu » — l'écran ne dirait plus pourquoi" \
	webapp/src/lib/sommeil-card.ts \
	"if (message === 'snooze_date_in_past') return 'echeance-passee'" \
	"if (message === 'snooze_date_in_past') return 'inconnu'"

titre "8. Restauration"

# CONSTATÉE, PAS SUPPOSÉE, et jamais comparée à HEAD (docs/SPEC-test-harness.md §7.2 point 9) : le
# harnais doit fonctionner dans un arbre portant une évolution légitime non encore committée.
for fichier in webapp/src/lib/sommeil-card.ts webapp/src/lib/filtre-sommeil.ts \
	webapp/src/lib/sommeil-fil.ts; do
	if cmp -s "$fichier" "$SAUVEGARDES/$(empreinte "$fichier")"; then
		ok "$(basename "$fichier") est identique OCTET À OCTET à son instantané d'avant dégradation"
	else
		fail "$(basename "$fichier") diffère de son instantané : une dégradation subsiste"
	fi
done

if npx vitest run "${TESTS_UNIT[@]}" >"$TRAVAIL/restaure.log" 2>&1; then
	ok "les preuves unitaires redeviennent vertes après restauration"
else
	fail_journal "les preuves restent ROUGES après restauration" "$TRAVAIL/restaure.log"
fi

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%s contrôles, %s en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
