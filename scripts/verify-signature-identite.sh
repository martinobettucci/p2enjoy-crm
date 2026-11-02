#!/usr/bin/env bash
# @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
#           TRANCHE 3 : LA SIGNATURE
# @verifies docs/SPEC-modeles-emails.md §10.2 (le nom, le type et la borne), §10.3 (la composition
#           et le septième refus), §10.4 (les trois états de l'effacement), §10.5 (la signature
#           appartient à l'identité), §10.6 (ce que l'écran lit et envoie), §10.7 (preuves exigées)
# @verifies docs/SCHEMA.md §7 ; docs/PROD_MIGRATIONS.md §3 (migration 58)
# @verifies docs/INCONSISTENCY_REPORT.md INC-215 (la colonne morte, CLOSE par cette tranche)
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
# @verifies CRM-111 (docs/BACKLOG.md) — tranche T1 ter.3, INC-304 : la garde d'empreinte (docs/SPEC-test-harness.md §3.8) ;
#           dégradations depuis les définitions en base, plus aucun rejeu des 23, 33 et 58 (§3.7)
# @verifies INC-335 (docs/BACKLOG.md, correctif de la décision 805, T1) — le seed porte trois identités, dont une seule
#           signe (docs/SPEC-seed.md §2.18)
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

# shellcheck source=scripts/lib/conteneur.sh
source scripts/lib/conteneur.sh
# @spec CRM-115 (docs/BACKLOG.md) T2, docs/SPEC-pile-par-session.md §6 : le conteneur se désigne par son service.
DB_CONTAINER=$(conteneur db)
MIGRATION=supabase/migrations/0058_signature_identite_sortante.sql
SUITE_SQL=supabase/tests/0056_signature_identite.test.sql
SUITE_API=e2e/api/signature-identite.spec.ts
SPEC=docs/SPEC-modeles-emails.md

# L'identité du seed qui SIGNE, retrouvée par son adresse : `apply-seed.sh` la crée par la route
# REST, et son identifiant est tiré au hasard à chaque application.
ADRESSE_DRISS='contact@p2enjoy.test'
SIGNATURE_DU_SEED='Driss Lemoine — Business developer'
# TROIS depuis la décision 805 (INC-335) : Camille a son identité, qui ne signe pas (docs/SPEC-seed.md §2.18).
IDENTITES_DU_SEED=3
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
		restaurer || statut=1
	fi
	# `CRM-111` T1 ter.3 (INC-304, décision 701) : la structure de public et app est-elle celle d'ouverture ? Sinon,
	# la base est reconstruite (docs/SPEC-test-harness.md §3.8).
	empreinte_garantir || statut=1
	rm -rf -- "$TRAVAIL" "${DEGRADATIONS_DOSSIER:-}"
	exit "$statut"
}
trap nettoyer EXIT
# shellcheck source=scripts/lib/empreinte.sh
source scripts/lib/empreinte.sh
empreinte_relever

ok()   { controles=$((controles + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { controles=$((controles + 1)); anomalies=$((anomalies + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() {
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 "$@"
}

suite_sql_verte() {
	scripts/run-sql-tests.sh "$SUITE_SQL" >"$TRAVAIL/tap.log" 2>&1 \
		&& grep -q 'aucune anomalie' "$TRAVAIL/tap.log"
}

# DÉGRADER SANS REJOUER LA 58 — `CRM-111` T1 ter.3, INC-304 (docs/SPEC-test-harness.md §3.7). Ce harnais dégradait une copie
# de la 58 et restaurait en la rejouant, après la 23 et la 33. Or la 58 n'est plus l'autorité de tout ce qu'elle définit :
# `queue_outbound_email` a été redéfinie par la 60, la 106 et la 109, et la signature du corps mis en file vit depuis la 60
# dans `app.mail_outbox_inserer` ; la 23 rejouée ramenait `mail_outbound_identity_record_check`, reprise par la 143, à sa
# forme d'origine. Désormais, une FONCTION se dégrade depuis sa définition EN BASE (`degradation_fonction`, le fragment
# exigé une fois exactement, l'application vérifiée) et se restaure par `degradations_restaurer` ; la BORNE, une
# contrainte, se dégrade par l'instruction seule et se restaure depuis sa définition relue en base à l'ouverture.
# shellcheck source=scripts/lib/degradation.sh
source scripts/lib/degradation.sh
BORNE=mail_outbound_identities_signature_borne
BORNE_ORIGINE=''

# Dégrade une fonction : $1 nom, $2 signature, $3 fragment d'origine, $4 remplacement.
degrader() {
	local nom=$1 signature=$2 avant=$3 apres=$4
	restauration_due=true
	if ! degradation_fonction "$signature" "$avant" "$apres"; then
		fail "dégradation « $nom » NON CONCLUANTE : fragment absent ou ambigu dans $signature, ou définition dégradée refusée"
		restaurer
		return 1
	fi
	return 0
}

restaurer() {
	local statut=0
	degradations_restaurer
	if [ -n "$BORNE_ORIGINE" ]; then
		psql_db -v ON_ERROR_STOP=1 -c "alter table public.mail_outbound_identities drop constraint if exists $BORNE;
			alter table public.mail_outbound_identities add constraint $BORNE $BORNE_ORIGINE;" >/dev/null 2>&1 || statut=1
	fi
	restauration_due=false
	return "$statut"
}

eprouver_degradation() {
	local nom=$1 signature=$2 avant=$3 apres=$4
	degrader "$nom" "$signature" "$avant" "$apres" || return 0
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

# RÉVISÉ PAR `CRM-111` T1 ter.3 (INC-304, décision 51). Cette section rejouait la 23, la 33 et la 58 sur la base à jour.
# Sa prémisse — « le runner rejoue tout le répertoire à chaque démarrage » — est fausse depuis le registre des migrations
# (`CRM-096`) : un fichier ne s'applique qu'une fois. Que chaque fichier se rejoue sur l'état qu'il produit est prouvé par
# `scripts/verify-migrations.sh`, sur une base neuve (docs/SPEC-test-harness.md §3.6) ; les rejouer ici ramenait des
# fonctions qu'une migration postérieure a redéfinies. Le sujet propre de la tranche, le renommage, est constaté en base.
if [ "$(psql_db -c "select count(*) filter (where column_name = 'signature_text') || ':' || count(*) filter (where column_name = 'signature_html')
	from information_schema.columns where table_schema = 'public' and table_name = 'mail_outbound_identities';")" = "1:0" ]; then
	ok "la colonne est renommée : signature_text existe, signature_html n'existe plus"
else
	fail "le renommage de signature_html en signature_text n'est pas celui que la 58 pose"
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
eprouver_degradation "le séparateur perd son espace de fin (RFC 3676)" 'app.mail_corps_signe(text,text)' \
	"E'\\n\\n--' || E' ' || E'\\n'" \
	"E'\\n\\n--' || E'' || E'\\n'"

# D-B — la signature blanche cesse d'être traitée comme absente : un séparateur suivi de rien.
eprouver_degradation "une signature blanche produit un séparateur suivi de rien" 'app.mail_corps_signe(text,text)' \
	"when app.btrim_blancs(p_signature) = '' then p_corps" \
	"when false then p_corps"

# D-C — les blancs de fin du corps ne sont plus retirés.
eprouver_degradation "les blancs de fin du corps ne sont plus retirés" 'app.mail_corps_signe(text,text)' \
	"else app.btrim_blancs(p_corps) || E'\\n\\n--'" \
	"else p_corps || E'\\n\\n--'"

# D-D — l'effacement redevient impossible : le `coalesce` d'avant la tranche.
eprouver_degradation "l'effacement redevient impossible (le coalesce d'avant)" \
	'public.upsert_mail_outbound_identity(uuid,text,text,integer,text,text,text,text,uuid,text,text,boolean,integer)' \
	"signature_text = case
		                          when p_signature_text is null then i.signature_text
		                          else v_signature
		                        end," \
	"signature_text = coalesce(p_signature_text, i.signature_text),"

# D-E — le septième refus disparaît : un message ne portant que sa signature partirait.
eprouver_degradation "le refus body_required disparaît" \
	'public.queue_outbound_email(uuid,uuid,text[],text,text,text[],uuid,text[],jsonb)' \
	"raise exception 'body_required' using errcode = '23514';" \
	"perform 1;"

# D-F — la garde cesse de signer : `mail_outbox` porterait le corps écrit, et non celui qui part.
# `CRM-111` T1 ter.3 : la signature du corps se fait depuis la 60 dans `app.mail_outbox_inserer`, l'insertion unique
# de la file, que `queue_outbound_email` appelle.
eprouver_degradation "la garde cesse de signer le corps mis en file" \
	'app.mail_outbox_inserer(uuid,uuid,uuid,uuid,text[],text[],text,text,text,uuid)' \
	"app.mail_corps_signe(p_body_text, p_signature)," \
	"p_body_text,"

# D-G — la borne est DESSERRÉE. Elle ne portait pas au premier essai, et c'est ce harnais qui l'a
# dit : la migration écrivait alors la valeur TROIS fois, si bien qu'aucune substitution ponctuelle
# ne pouvait la changer — la convergence ramenait la borne à deux mille, la suite pgTAP restait
# verte, et le verdict « COMPLAISANT » accusait la suite d'un défaut qui était celui de la
# dégradation. La migration écrit désormais la borne UNE fois, et un seul point suffit.
# `CRM-111` T1 ter.3 : la borne est une CONTRAINTE ; elle se desserre par l'instruction, et se restaure depuis sa
# définition relue en base (`BORNE_ORIGINE`).
BORNE_ORIGINE=$(psql_db -c "select pg_get_constraintdef(oid) from pg_constraint
	where conrelid = 'public.mail_outbound_identities'::regclass and conname = '$BORNE';")
restauration_due=true
if [ -n "$BORNE_ORIGINE" ] && psql_db -v ON_ERROR_STOP=1 -c "alter table public.mail_outbound_identities drop constraint $BORNE;
	alter table public.mail_outbound_identities add constraint $BORNE check (char_length(signature_text) <= 200000);" >/dev/null 2>&1; then
	if suite_sql_verte; then
		fail "COMPLAISANT — « la borne de la signature est desserrée » retirée, la suite pgTAP reste VERTE"
	else
		ok "dégradation « la borne de la signature est desserrée » : la suite pgTAP rougit, comme elle doit"
	fi
else
	fail "dégradation « la borne de la signature est desserrée » NON APPLIQUÉE"
fi
restaurer

# =================================================================================================
echo
echo "8. La restauration est CONSTATÉE, octet à octet, et la base avec elle"
# =================================================================================================

restaurer

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
