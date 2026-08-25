#!/usr/bin/env bash
# @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
#           TRANCHE 3 : LA SIGNATURE
# @verifies docs/SPEC-modeles-emails.md §10.2 (le nom, le type et la borne), §10.3 (la composition
#           et le septième refus), §10.4 (les trois états de l'effacement), §10.5 (la signature
#           appartient à l'identité), §10.6 (ce que l'écran lit et envoie), §10.7 (preuves exigées)
# @verifies docs/SCHEMA.md §7 ; docs/PROD_MIGRATIONS.md §3 (migration 58)
# @verifies docs/INCONSISTENCY_REPORT.md INC-215 (la colonne morte, CLOSE par cette tranche)
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée et
# seedée. Il rejoue les preuves de la tranche, puis DÉGRADE RÉELLEMENT la migration — une
# dégradation par règle qu'elle porte — et exige que la suite pgTAP rougisse. Aucun état dégradé ne
# subsiste, même en cas d'échec : la migration est rejouée par un `trap`.
#
# CE QUE CE HARNAIS SURVEILLE EN PROPRE, ET QU'AUCUN AUTRE NE PEUT VOIR. Cette tranche est la
# PREMIÈRE du dépôt à RENOMMER une colonne, et le renommage a condamné deux écritures antérieures —
# le `grant select (…)` de la migration 23 et les `create or replace function` des migrations 23 et
# 33. Le §2 ci-dessous rejoue donc le répertoire de migrations DANS SON ENTIER et exige qu'il
# s'applique : c'est le seul contrôle du dépôt qui dénoncerait une convergence perdue, et il vaut
# pour toute migration future qui renommerait quoi que ce soit.
#
# CE QUE CE HARNAIS NE PROUVE PAS, et qui est dit plutôt que sous-entendu
# (`docs/SPEC-test-harness.md` §7.2 point 3) : aucun ENVOI RÉEL — la signature est éprouvée jusqu'à
# `mail_outbox`, pas jusqu'au destinataire, ce que `e2e/mail` fait ailleurs ; aucune SÉQUENCE de
# relance, qui est la tranche 4.

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0058_signature_identite_sortante.sql
SUITE_SQL=supabase/tests/0056_signature_identite.test.sql
SUITE_API=e2e/api/signature-identite.spec.ts
SPEC=docs/SPEC-modeles-emails.md

# L'identité du seed qui SIGNE, retrouvée par son adresse : `apply-seed.sh` la crée par la route
# REST, et son identifiant est tiré au hasard à chaque application.
ADRESSE_DRISS='contact@p2enjoy.test'
SIGNATURE_DU_SEED='Driss Lemoine — Business developer'
IDENTITES_DU_SEED=2
SIGNATURES_DU_SEED=1
BORNE_SIGNATURE=2000

RAPIDE=false
[ "${1:-}" = '--rapide' ] && RAPIDE=true

controles=0
anomalies=0
TRAVAIL=$(mktemp -d)
restauration_due=false

nettoyer() {
	local statut=$?
	trap - EXIT
	set +e
	if [ "$restauration_due" = true ]; then
		if ! psql_db -f - < "$MIGRATION" >/dev/null 2>&1; then
			printf 'ERREUR : la restauration de secours de %s a échoué.\n' "$MIGRATION" >&2
			statut=1
		fi
	fi
	rm -rf -- "$TRAVAIL"
	exit "$statut"
}
trap nettoyer EXIT

ok()   { controles=$((controles + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { controles=$((controles + 1)); anomalies=$((anomalies + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() {
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 "$@"
}

suite_sql_verte() {
	scripts/run-sql-tests.sh "$SUITE_SQL" >"$TRAVAIL/tap.log" 2>&1 \
		&& grep -q 'aucune anomalie' "$TRAVAIL/tap.log"
}

# Substitue dans une COPIE de la migration, puis l'applique. La copie précédente est DÉTRUITE
# d'abord, et l'échec du substituteur est TESTÉ : c'est le défaut que le harnais jumeau a trouvé
# dans son propre code le 2026-08-25 (§2.11) — `degrader` appelée dans un `||` suspend `set -e`,
# si bien qu'un motif ambigu laissait réappliquer la dégradation PRÉCÉDENTE en annonçant la
# nouvelle comme mordante. Le remède est repris ici tel quel plutôt que redécouvert.
degrader() {
	local avant=$1 apres=$2 nom=$3
	rm -f -- "$TRAVAIL/degrade.sql"
	if ! python3 - "$MIGRATION" "$TRAVAIL/degrade.sql" "$avant" "$apres" <<-'PY'
		import io, sys
		source, cible, avant, apres = sys.argv[1:5]
		texte = io.open(source, encoding='utf-8').read()
		if texte.count(avant) != 1:
		    sys.exit(f"motif absent ou ambigu ({texte.count(avant)} occurrence(s))")
		io.open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres))
	PY
	then
		fail "dégradation « $nom » IMPOSSIBLE : motif absent ou ambigu dans $MIGRATION"
		return 1
	fi
	if cmp -s "$MIGRATION" "$TRAVAIL/degrade.sql"; then
		fail "dégradation « $nom » IMPOSSIBLE : la substitution n'a rien changé"
		return 1
	fi
	# LA DÉGRADATION DOIT S'APPLIQUER, ET C'EST UN DÉFAUT TROUVÉ PAR CE HARNAIS DANS CE HARNAIS,
	# le 2026-08-25. Une dégradation dont le SQL ne compile pas — un `trou[1]` posé sur un `text`,
	# par exemple — laisse la base INCHANGÉE : la suite pgTAP reste alors verte, et le harnais
	# conclut « COMPLAISANT » alors que rien n'a été dégradé. C'est la même famille de mensonge
	# tranquille que le §2.11 a corrigée sur le substituteur, sous une forme nouvelle — là c'était
	# la SUBSTITUTION qui échouait sans arrêter, ici c'est l'APPLICATION. Le code de retour de
	# `psql` est donc TESTÉ, et un échec est nommé « IMPOSSIBLE » plutôt que compté pour une preuve.
	restauration_due=true
	if ! psql_db -f - < "$TRAVAIL/degrade.sql" >"$TRAVAIL/degrade.log" 2>&1; then
		fail "dégradation « $nom » IMPOSSIBLE : le SQL dégradé ne s'applique pas — $(tail -n 1 "$TRAVAIL/degrade.log")"
		restaurer
		return 1
	fi
	return 0
}

restaurer() {
	psql_db -f - < "$MIGRATION" >/dev/null 2>&1
	restauration_due=false
}


eprouver_degradation() {
	local nom=$1 avant=$2 apres=$3
	degrader "$avant" "$apres" "$nom" || return 0
	if suite_sql_verte; then
		fail "COMPLAISANT — « $nom » retirée, la suite pgTAP reste VERTE"
	else
		ok "dégradation « $nom » : la suite pgTAP rougit, comme elle doit"
	fi
	restaurer
}

echo
echo "Preuves de CRM-063 tranche 3 — la signature d'une identité sortante"
echo

if [ ! -f .env ] || ! grep -q '^P2ENJOY_ENV_PROFILE=dev$' .env; then
	echo "ERREUR : ce harnais exige le profil local dev dans .env." >&2
	exit 1
fi
if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER absent ou arrêté. Lancez ./runDev.sh." >&2
	exit 1
fi

cp "$MIGRATION" "$TRAVAIL/migration.origine"

# =================================================================================================
echo "1. Traçabilité : aucun fichier de la tranche n'est orphelin de sa spécification"
# =================================================================================================

if head -n 12 "$MIGRATION" | grep -q '@spec CRM-063' \
	&& head -n 12 "$MIGRATION" | grep -q 'docs/SPEC-modeles-emails.md'; then
	ok "la migration 58 cite son unité de backlog et sa spécification"
else
	fail "la migration 58 n'a pas ses commentaires @spec (CLAUDE.md §5)"
fi

for fichier in "$SUITE_SQL" "$SUITE_API" webapp/src/lib/mail-identites.ts; do
	if head -n 14 "$fichier" | grep -qE '@(spec|verifies) CRM-063' \
		&& head -n 14 "$fichier" | grep -q 'docs/SPEC-modeles-emails.md'; then
		ok "$(basename "$fichier") cite CRM-063 et sa spécification"
	else
		fail "$(basename "$fichier") n'a pas ses commentaires de traçabilité"
	fi
done

if grep -q '^### 10.3 DEUXIÈME QUESTION' "$SPEC"; then
	ok "le §10 de la spécification existe et porte la question de la composition"
else
	fail "le §10 de docs/SPEC-modeles-emails.md est absent : le code précéderait sa spécification"
fi

# =================================================================================================
echo
echo "2. LE RENOMMAGE N'A PAS CASSÉ LE REJEU — le contrôle propre à cette tranche"
# =================================================================================================
# Le `migrations-runner` ne tient AUCUN registre et rejoue tout le répertoire à chaque démarrage
# (`docs/DAT.md` §3.2). Un renommage de colonne condamne toute migration antérieure qui nomme
# l'ancien nom, et la panne ne se voit qu'au DEUXIÈME démarrage suivant — c'est-à-dire chez le
# prochain contributeur, jamais chez celui qui a écrit le renommage.

if psql_db -f - < supabase/migrations/0023_identites_sortantes_smtp.sql >"$TRAVAIL/rejeu23.log" 2>&1; then
	ok "la migration 23 se rejoue après le renommage — son grant de colonne ne nomme plus la signature"
else
	fail "la migration 23 NE SE REJOUE PLUS : $(tail -n 1 "$TRAVAIL/rejeu23.log")"
fi

if psql_db -f - < supabase/migrations/0033_quota_par_defaut.sql >"$TRAVAIL/rejeu33.log" 2>&1; then
	ok "la migration 33 se rejoue — elle RETIRE la fonction avant de la reposer"
else
	fail "la migration 33 NE SE REJOUE PLUS : $(tail -n 1 "$TRAVAIL/rejeu33.log")"
fi

if psql_db -f - < "$MIGRATION" >"$TRAVAIL/rejeu58.log" 2>&1 \
	&& psql_db -f - < "$MIGRATION" >>"$TRAVAIL/rejeu58.log" 2>&1; then
	ok "la migration 58 est rejouable DEUX fois de suite : le renommage est gardé, la borne converge"
else
	fail "la migration 58 n'est pas idempotente : $(tail -n 1 "$TRAVAIL/rejeu58.log")"
fi

# APRÈS CES REJEUX, la fonction doit porter le NOUVEAU nom de paramètre. Si l'une des deux
# migrations antérieures l'avait reposée avec l'ancien, PostgREST exposerait `p_signature_html` et
# l'écran écrirait dans le vide.
if [ "$(psql_db -c "select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'upsert_mail_outbound_identity';" | grep -c 'p_signature_text')" = 1 ]; then
	ok "après les trois rejeux, le paramètre est bien p_signature_text"
else
	fail "le paramètre est revenu à p_signature_html : une migration antérieure a repris la main"
fi

# =================================================================================================
echo
echo "3. La colonne, sa borne et ses privilèges — §10.2"
# =================================================================================================

if [ "$(psql_db -c "select count(*) from information_schema.columns where table_schema='public' and table_name='mail_outbound_identities' and column_name='signature_text';")" = 1 ]; then
	ok "la colonne signature_text existe"
else
	fail "la colonne signature_text est ABSENTE"
fi

if [ "$(psql_db -c "select count(*) from information_schema.columns where table_schema='public' and table_name='mail_outbound_identities' and column_name='signature_html';")" = 0 ]; then
	ok "signature_html a disparu : INC-215 est close, pas contournée"
else
	fail "signature_html existe ENCORE : le renommage n'a pas eu lieu"
fi

if [ "$(psql_db -c "select pg_get_constraintdef(oid) from pg_constraint where conname='mail_outbound_identities_signature_borne';")" = "CHECK ((char_length(signature_text) <= $BORNE_SIGNATURE))" ]; then
	ok "la borne de $BORNE_SIGNATURE caractères est posée, et c'est SA définition qui est lue"
else
	fail "la borne de signature est absente ou différente de ce que le §10.2 annonce"
fi

if [ "$(psql_db -c "select has_column_privilege('authenticated','public.mail_outbound_identities','signature_text','select');")" = t ] \
	&& [ "$(psql_db -c "select has_column_privilege('anon','public.mail_outbound_identities','signature_text','select');")" = f ]; then
	ok "authenticated LIT la signature, anon ne la lit pas"
else
	fail "les privilèges de colonne sont faux : le grant de la 58 n'a pas été reposé"
fi

# =================================================================================================
echo
echo "4. La composition, caractère à caractère — §10.3"
# =================================================================================================
# LES COMPARAISONS PASSENT PAR `encode(convert_to(…, 'UTF8'), 'hex')` PLUTÔT QUE PAR LE TEXTE BRUT,
# et le motif est l'espace de fin du séparateur : `psql -qtA` la rend, mais toute capture par `$( )`
# la ROGNERAIT — un contrôle qui compare des chaînes rognées ne peut pas voir disparaître le seul
# caractère qui décide si les clients de messagerie replient la signature.

hexa() { psql_db -c "select encode(convert_to($1, 'UTF8'), 'hex');"; }

attendu=$(hexa "'Bonjour.' || chr(10) || chr(10) || '-- ' || chr(10) || 'Driss'")
obtenu=$(hexa "app.mail_corps_signe('Bonjour.', 'Driss')")
if [ "$attendu" = "$obtenu" ] && [ -n "$attendu" ]; then
	ok "le corps signé est EXACTEMENT « corps, ligne vide, -- espace, signature » (octets comparés)"
else
	fail "le corps signé diffère de la forme du §10.3 : attendu=$attendu obtenu=$obtenu"
fi

if [ "$(psql_db -c "select app.mail_corps_signe('Corps.', null) = 'Corps.' and app.mail_corps_signe('Corps.', '   ') = 'Corps.';")" = t ]; then
	ok "une signature absente ou blanche rend le corps INCHANGÉ"
else
	fail "une signature absente ou blanche modifie le corps"
fi

if [ "$(psql_db -c "select app.mail_corps_signe('Corps.' || chr(10) || chr(10), 'S') = app.mail_corps_signe('Corps.', 'S');")" = t ]; then
	ok "les blancs de fin du corps sont retirés avant la ligne vide"
else
	fail "un corps terminé par des retours à la ligne produit des lignes vides en trop"
fi

if [ "$(psql_db -c "select provolatile = 'i' and not prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='app' and p.proname='mail_corps_signe';")" = t ]; then
	ok "la composition est IMMUTABLE et SECURITY INVOKER"
else
	fail "la composition a changé de volatilité ou emprunte des droits"
fi

# =================================================================================================
echo
echo "5. Le seed démontre les DEUX états de la colonne"
# =================================================================================================

if [ "$(psql_db -c "select count(*) from public.mail_outbound_identities;")" = "$IDENTITES_DU_SEED" ]; then
	ok "le seed porte $IDENTITES_DU_SEED identités sortantes"
else
	fail "le seed ne porte plus $IDENTITES_DU_SEED identités sortantes"
fi

if [ "$(psql_db -c "select count(*) from public.mail_outbound_identities where signature_text is not null;")" = "$SIGNATURES_DU_SEED" ]; then
	ok "exactement $SIGNATURES_DU_SEED identité SIGNE : le jeu montre la différence au lieu de la décrire"
else
	fail "le nombre d'identités qui signent n'est plus $SIGNATURES_DU_SEED — le jeu ne démontre plus rien"
fi

if [ "$(psql_db -c "select signature_text like '%' || chr(10) || '%' from public.mail_outbound_identities where from_address = '$ADRESSE_DRISS';")" = t ]; then
	ok "la signature du seed est MULTILIGNE : la conservation des retours à la ligne est démontrable"
else
	fail "la signature du seed tient sur une ligne — un séparateur l'a aplatie"
fi

# =================================================================================================
echo
echo "6. Les preuves de la tranche passent"
# =================================================================================================

if suite_sql_verte; then
	ok "la suite pgTAP $(basename "$SUITE_SQL") est VERTE"
else
	fail "la suite pgTAP est rouge : $(tail -n 3 "$TRAVAIL/tap.log" | tr '\n' ' ')"
fi

if [ "$RAPIDE" = false ]; then
	if npx playwright test --config e2e/playwright.config.ts --project=api signature-identite \
		>"$TRAVAIL/api.log" 2>&1; then
		ok "le contrat d'API $(basename "$SUITE_API") est VERT"
	else
		fail "le contrat d'API est rouge : $(tail -n 3 "$TRAVAIL/api.log" | tr '\n' ' ')"
	fi
else
	echo "  (--rapide : le contrat d'API n'est pas rejoué)"
fi

# =================================================================================================
echo
echo "7. DÉGRADATIONS RÉELLES — la suite doit savoir rougir"
# =================================================================================================
# Une par RÈGLE que la migration porte. Chaque dégradation retire exactement une décision du §10,
# et une suite qui resterait verte serait un trou dans la preuve, nommé « COMPLAISANT ».

# D-A — le séparateur perd son espace de fin. C'est la dégradation la plus importante du harnais :
# l'espace est invisible à la relecture, et sans elle les clients de messagerie cessent de replier
# la signature. Si la suite restait verte, plus rien ne tiendrait ce caractère.
eprouver_degradation "le séparateur perd son espace de fin (RFC 3676)" \
	"E'\\n\\n--' || E' ' || E'\\n'" \
	"E'\\n\\n--' || E'' || E'\\n'"

# D-B — la signature blanche cesse d'être traitée comme absente : un séparateur suivi de rien.
eprouver_degradation "une signature blanche produit un séparateur suivi de rien" \
	"when app.btrim_blancs(p_signature) = '' then p_corps" \
	"when false then p_corps"

# D-C — les blancs de fin du corps ne sont plus retirés.
eprouver_degradation "les blancs de fin du corps ne sont plus retirés" \
	"else app.btrim_blancs(p_corps) || E'\\n\\n--'" \
	"else p_corps || E'\\n\\n--'"

# D-D — l'effacement redevient impossible : le `coalesce` d'avant la tranche.
eprouver_degradation "l'effacement redevient impossible (le coalesce d'avant)" \
	"signature_text = case
		                          when p_signature_text is null then i.signature_text
		                          else v_signature
		                        end," \
	"signature_text = coalesce(p_signature_text, i.signature_text),"

# D-E — le septième refus disparaît : un message ne portant que sa signature partirait.
eprouver_degradation "le refus body_required disparaît" \
	"raise exception 'body_required' using errcode = '23514';" \
	"perform 1;"

# D-F — la garde cesse de signer : `mail_outbox` porterait le corps écrit, et non celui qui part.
eprouver_degradation "la garde cesse de signer le corps mis en file" \
	"app.mail_corps_signe(p_body_text, v_identite.signature_text)," \
	"p_body_text,"

# D-G — la borne est DESSERRÉE. Elle ne portait pas au premier essai, et c'est ce harnais qui l'a
# dit : la migration écrivait alors la valeur TROIS fois, si bien qu'aucune substitution ponctuelle
# ne pouvait la changer — la convergence ramenait la borne à deux mille, la suite pgTAP restait
# verte, et le verdict « COMPLAISANT » accusait la suite d'un défaut qui était celui de la
# dégradation. La migration écrit désormais la borne UNE fois, et un seul point suffit.
eprouver_degradation "la borne de la signature est desserrée" \
	"v_borne constant integer := 2000;" \
	"v_borne constant integer := 200000;"

# =================================================================================================
echo
echo "8. La restauration est CONSTATÉE, octet à octet, et la base avec elle"
# =================================================================================================

restaurer
psql_db -f - < supabase/migrations/0023_identites_sortantes_smtp.sql >/dev/null 2>&1
psql_db -f - < supabase/migrations/0033_quota_par_defaut.sql >/dev/null 2>&1
psql_db -f - < "$MIGRATION" >/dev/null 2>&1

if cmp -s "$MIGRATION" "$TRAVAIL/migration.origine"; then
	ok "le fichier de migration est restauré à l'octet près"
else
	fail "le fichier de migration DIFFÈRE de l'instantané pris avant la première dégradation"
fi

attendu=$(hexa "'Bonjour.' || chr(10) || chr(10) || '-- ' || chr(10) || 'Driss'")
obtenu=$(hexa "app.mail_corps_signe('Bonjour.', 'Driss')")
if [ "$attendu" = "$obtenu" ]; then
	ok "la base est restaurée : la composition rend de nouveau la forme du §10.3"
else
	fail "la base est restée DÉGRADÉE — un état dégradé ne doit jamais survivre au harnais"
fi

if suite_sql_verte; then
	ok "après restauration, la suite pgTAP est de nouveau VERTE"
else
	fail "la suite pgTAP reste rouge après restauration"
fi

compte_final=$(psql_db -c "select count(*) from public.mail_outbound_identities where signature_text is not null;")
if [ "$compte_final" = "$SIGNATURES_DU_SEED" ]; then
	ok "le seed est rendu INTACT : $SIGNATURES_DU_SEED identité signe, comme à l'entrée"
else
	fail "le seed porte $compte_final signature(s) au lieu de $SIGNATURES_DU_SEED"
fi

echo
if [ "$anomalies" -eq 0 ]; then
	echo "Bilan : $controles contrôles, aucune anomalie."
	exit 0
fi
echo "Bilan : $controles contrôles, $anomalies anomalie(s)." >&2
exit 1
